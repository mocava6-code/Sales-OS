// Pure, Next.js-free application handlers — the actual logic behind every
// server action in server/actions/decisions.ts. Kept separate from the
// "use server" file so they're directly unit-testable (no next/headers,
// no cookies(), no real Prisma connection) with injected dependencies —
// see server/application/__tests__. Every dependency defaults to the real
// implementation, so server/actions/decisions.ts needs to pass nothing.
//
// Every handler follows the same five steps, strictly in order: (1)
// authenticate, (2) validate input, (3) construct/resolve dependencies,
// (4) call orchestration, (5) map the result/error. Step 3 deliberately
// comes after 1 and 2 — resolving the AI provider or a decision record
// touches the environment/database, so an unauthenticated or malformed
// request must never pay that cost (or surface its failures) before its
// own, more specific rejection. Nothing here re-implements a
// status-transition rule, an attribution rule, or any other business logic
// already owned by server/orchestration/** — that would duplicate it,
// which the phase brief explicitly forbids.

import {
  analyzeConversationSchema,
  approveDecisionSchema,
  executeDecisionSchema,
  recordAdvisorOverrideSchema,
  recordOutcomeSchema,
  recordSaleOutcomeSchema,
  rejectDecisionSchema,
} from "@/lib/validations/decision";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import type { KnowledgeSource } from "@/server/intelligence/knowledge-source";
import { analyzeConversationAndCreateDecisions } from "@/server/orchestration/analyze-conversation-and-create-decisions";
import { approveDecision, executeDecision, recordAdvisorOverride, rejectDecision } from "@/server/orchestration/decision-workflows";
import {
  recordConversationAbandoned,
  recordCustomerReply,
  recordFollowUpSent,
  recordQuotationRequested,
  recordQuotationSent,
  recordSaleClosed,
  recordSaleLost,
} from "@/server/orchestration/outcome-workflows";
import type { OutcomeWorkflowResult, RecordOutcomeWorkflowInput } from "@/server/orchestration/types";
import type { SavedDecisionRecord } from "@/server/persistence/types";
import type { TransactionRunner } from "@/server/persistence/unit-of-work";
import type { z } from "zod";
import {
  type AuthorizedConversation,
  assertCanApprove,
  loadAuthorizedConversation,
  loadAuthorizedDecisionRecord,
} from "./access-control";
import { buildEngineInputFromConversation } from "./analyze-conversation-input";
import { withAnalysisRunLock } from "./analysis-run-lock";
import { type AuthContextResolver, type AuthenticatedUser, defaultAuthContextResolver, requireAuthenticatedUser } from "./auth";
import { getAIProvider, getKnowledgeSource, getTransactionRunner } from "./composition-root";
import {
  type AnalyzeConversationSummaryDTO,
  type DecisionSummaryDTO,
  type OutcomeSummaryDTO,
  toAnalyzeConversationSummaryDTO,
  toDecisionSummaryDTO,
  toOutcomeSummaryDTO,
} from "./dto";
import { type ApplicationResult, InvalidInputError, toApplicationResult } from "./errors";

export interface ActionDependencies {
  resolver?: AuthContextResolver;
  transactionRunner?: TransactionRunner;
  /** Defaults to loadAuthorizedDecisionRecord (real Prisma lookup, tenant-scoped). */
  loadDecisionRecord?: (user: AuthenticatedUser, decisionRecordId: string) => Promise<SavedDecisionRecord>;
}

export interface AnalyzeActionDependencies {
  resolver?: AuthContextResolver;
  transactionRunner?: TransactionRunner;
  aiProvider?: AIProvider;
  /** Defaults to getKnowledgeSource() (real, OWNER-approved KnowledgeItem retrieval). */
  knowledgeSource?: KnowledgeSource;
  /** Defaults to loadAuthorizedConversation (real Prisma lookup, tenant-scoped). */
  loadConversation?: (user: AuthenticatedUser, conversationId: string) => Promise<AuthorizedConversation>;
  /** Defaults to withAnalysisRunLock (real Postgres unique-constraint guard). */
  runWithAnalysisLock?: <T>(businessId: string, conversationId: string, work: () => Promise<T>) => Promise<T>;
}

function parseOrThrow<Schema extends z.ZodTypeAny>(schema: Schema, rawInput: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    throw new InvalidInputError(parsed.error.flatten().fieldErrors);
  }
  return parsed.data;
}

// --- Decision workflows --------------------------------------------------------

export function approveDecisionHandler(
  rawInput: unknown,
  dependencies: ActionDependencies = {},
): Promise<ApplicationResult<DecisionSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(approveDecisionSchema, rawInput);

    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const loadDecisionRecord = dependencies.loadDecisionRecord ?? loadAuthorizedDecisionRecord;

    const existing = await loadDecisionRecord(user, input.decisionRecordId);
    assertCanApprove(user, existing.decision.approvalRequirement);

    const result = await approveDecision(
      {
        decisionRecordId: input.decisionRecordId,
        note: input.note,
        advisorAction: input.advisorAction ? { ...input.advisorAction, advisorUserId: user.id } : undefined,
      },
      { transactionRunner },
    );

    return toDecisionSummaryDTO(result.decision);
  });
}

export function rejectDecisionHandler(
  rawInput: unknown,
  dependencies: ActionDependencies = {},
): Promise<ApplicationResult<DecisionSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(rejectDecisionSchema, rawInput);

    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const loadDecisionRecord = dependencies.loadDecisionRecord ?? loadAuthorizedDecisionRecord;

    await loadDecisionRecord(user, input.decisionRecordId);

    const result = await rejectDecision(
      {
        decisionRecordId: input.decisionRecordId,
        note: input.note,
        advisorAction: input.advisorAction ? { ...input.advisorAction, advisorUserId: user.id } : undefined,
      },
      { transactionRunner },
    );

    return toDecisionSummaryDTO(result.decision);
  });
}

export function executeDecisionHandler(
  rawInput: unknown,
  dependencies: ActionDependencies = {},
): Promise<ApplicationResult<DecisionSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(executeDecisionSchema, rawInput);

    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const loadDecisionRecord = dependencies.loadDecisionRecord ?? loadAuthorizedDecisionRecord;

    await loadDecisionRecord(user, input.decisionRecordId);

    const result = await executeDecision(
      {
        decisionRecordId: input.decisionRecordId,
        note: input.note,
        advisorAction: input.advisorAction ? { ...input.advisorAction, advisorUserId: user.id } : undefined,
      },
      { transactionRunner },
    );

    return toDecisionSummaryDTO(result.decision);
  });
}

export function recordAdvisorOverrideHandler(
  rawInput: unknown,
  dependencies: ActionDependencies = {},
): Promise<ApplicationResult<DecisionSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(recordAdvisorOverrideSchema, rawInput);

    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const loadDecisionRecord = dependencies.loadDecisionRecord ?? loadAuthorizedDecisionRecord;

    await loadDecisionRecord(user, input.decisionRecordId);

    const result = await recordAdvisorOverride(
      {
        decisionRecordId: input.decisionRecordId,
        actionType: input.actionType,
        notes: input.notes,
        advisorUserId: user.id,
      },
      { transactionRunner },
    );

    return toDecisionSummaryDTO(result.decision);
  });
}

// --- Outcome workflows -----------------------------------------------------

async function runOutcomeAction(
  schema: z.ZodTypeAny,
  orchestrationFn: (input: RecordOutcomeWorkflowInput, deps: { transactionRunner: TransactionRunner }) => Promise<OutcomeWorkflowResult>,
  rawInput: unknown,
  dependencies: ActionDependencies,
): Promise<ApplicationResult<OutcomeSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(schema, rawInput) as RecordOutcomeWorkflowInput;

    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const loadDecisionRecord = dependencies.loadDecisionRecord ?? loadAuthorizedDecisionRecord;

    await loadDecisionRecord(user, input.decisionRecordId);

    const result = await orchestrationFn(input, { transactionRunner });
    return toOutcomeSummaryDTO(result.outcome);
  });
}

export function recordCustomerReplyHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordOutcomeSchema, recordCustomerReply, rawInput, dependencies);
}

export function recordFollowUpSentHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordOutcomeSchema, recordFollowUpSent, rawInput, dependencies);
}

export function recordQuotationRequestedHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordOutcomeSchema, recordQuotationRequested, rawInput, dependencies);
}

export function recordQuotationSentHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordOutcomeSchema, recordQuotationSent, rawInput, dependencies);
}

export function recordSaleClosedHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordSaleOutcomeSchema, recordSaleClosed, rawInput, dependencies);
}

export function recordSaleLostHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordSaleOutcomeSchema, recordSaleLost, rawInput, dependencies);
}

export function recordConversationAbandonedHandler(rawInput: unknown, dependencies: ActionDependencies = {}) {
  return runOutcomeAction(recordOutcomeSchema, recordConversationAbandoned, rawInput, dependencies);
}

// --- Analyze conversation ----------------------------------------------------

export function analyzeConversationHandler(
  rawInput: unknown,
  dependencies: AnalyzeActionDependencies = {},
): Promise<ApplicationResult<AnalyzeConversationSummaryDTO>> {
  return toApplicationResult(async () => {
    const user = await requireAuthenticatedUser(dependencies.resolver ?? defaultAuthContextResolver);
    const input = parseOrThrow(analyzeConversationSchema, rawInput);

    const loadConversation = dependencies.loadConversation ?? loadAuthorizedConversation;
    const conversation = await loadConversation(user, input.conversationId);
    const engineInput = buildEngineInputFromConversation(user.businessId, conversation);

    // Resolved only once we know there's a real conversation to analyze —
    // no reason to construct the AI provider or open a lock for a request
    // that was going to fail at the lookup anyway.
    const aiProvider = dependencies.aiProvider ?? getAIProvider();
    const transactionRunner = dependencies.transactionRunner ?? getTransactionRunner();
    const knowledgeSource = dependencies.knowledgeSource ?? getKnowledgeSource();
    const runWithAnalysisLock = dependencies.runWithAnalysisLock ?? withAnalysisRunLock;

    const result = await runWithAnalysisLock(user.businessId, conversation.id, () =>
      analyzeConversationAndCreateDecisions(
        {
          businessId: user.businessId,
          conversationId: conversation.id,
          conversationIntelligenceInput: engineInput,
        },
        { aiProvider, transactionRunner, knowledgeSource },
      ),
    );

    return toAnalyzeConversationSummaryDTO(result);
  });
}
