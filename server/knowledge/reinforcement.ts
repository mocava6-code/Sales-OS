// Converges one extracted candidate onto the Knowledge Base's existing
// state (Sprint 8 review, item 5's pipeline): normalized subject/key search
// -> lexical shortlist -> deterministic obvious-equivalence checks ->
// optional grounded LLM relationship classification -> validated
// deterministic status transition (candidate-status.ts). The LLM never
// writes status/promotes/supersedes/deletes anything — every write in this
// file is decided by deriveCandidateStatus, a pure function.

import { prisma } from "@/server/db/client";
import type { BehaviorCategory, KnowledgeCategory, PrismaClient, RelationshipClassification } from "@/server/db/generated/client";
import type { AIProvider } from "@/server/intelligence/ai-provider";
import { deriveCandidateStatus, type PipelineCandidateStatus, type RelationshipClassificationValue } from "./candidate-status";
import type { ExtractedKnowledgeCandidate } from "./extracted-candidate";
import { classifyRelationship, KORI_RELATIONSHIP_CLASSIFICATION_PROMPT_VERSION } from "./relationship-classifier";
import { jaccardSimilarity, normalizeKey } from "./subject-similarity";
import { OBVIOUS_EQUIVALENCE_THRESHOLD, OBVIOUS_UNRELATED_THRESHOLD, SUBJECT_SHORTLIST_THRESHOLD } from "./thresholds";

interface ShortlistEntry {
  kind: "CANDIDATE" | "KNOWLEDGE_ITEM" | "OPERATIONAL_INSIGHT";
  id: string;
  subjectText: string;
  statementText: string;
  currentStatus?: PipelineCandidateStatus; // only for kind: CANDIDATE
}

interface ClassifiedMatch {
  entry: ShortlistEntry;
  classification: RelationshipClassificationValue;
  confidence: number | null;
  classifierName: "deterministic-jaccard" | "kori-llm";
  classifierVersion: string;
}

async function buildShortlist(
  db: PrismaClient,
  businessId: string,
  extracted: ExtractedKnowledgeCandidate,
): Promise<ShortlistEntry[]> {
  const pendingCandidates = await db.knowledgeCandidate.findMany({
    where: {
      businessId,
      class: extracted.class,
      status: { in: ["NEW", "REINFORCED", "CONFLICT"] },
      ...(extracted.class === "FACTUAL"
        ? { proposedFactualCategory: extracted.proposedCategory as KnowledgeCategory }
        : { proposedBehaviorCategory: extracted.proposedCategory as BehaviorCategory }),
    },
    select: { id: true, subject: true, statement: true, status: true },
  });

  const pool: ShortlistEntry[] = pendingCandidates.map((c) => ({
    kind: "CANDIDATE",
    id: c.id,
    subjectText: c.subject,
    statementText: c.statement,
    currentStatus: c.status as PipelineCandidateStatus,
  }));

  if (extracted.class === "FACTUAL") {
    const items = await db.knowledgeItem.findMany({
      where: { businessId, category: extracted.proposedCategory as KnowledgeCategory, status: "ACTIVE" },
      select: { id: true, title: true, content: true },
    });
    pool.push(...items.map((i) => ({ kind: "KNOWLEDGE_ITEM" as const, id: i.id, subjectText: i.title, statementText: i.content })));
  } else {
    const insights = await db.operationalInsight.findMany({
      where: { businessId, category: extracted.proposedCategory as BehaviorCategory, status: "ACTIVE" },
      select: { id: true, statement: true },
    });
    // OperationalInsight has no separate subject/title column — the
    // statement itself is the only text to compare against.
    pool.push(...insights.map((i) => ({ kind: "OPERATIONAL_INSIGHT" as const, id: i.id, subjectText: i.statement, statementText: i.statement })));
  }

  return pool.filter((entry) => jaccardSimilarity(extracted.subject, entry.subjectText) >= SUBJECT_SHORTLIST_THRESHOLD);
}

async function classifyShortlist(
  shortlist: ShortlistEntry[],
  extracted: ExtractedKnowledgeCandidate,
  aiProvider: AIProvider,
): Promise<ClassifiedMatch[]> {
  const results: ClassifiedMatch[] = [];

  for (const entry of shortlist) {
    const statementSimilarity = jaccardSimilarity(extracted.statement, entry.statementText);

    if (statementSimilarity >= OBVIOUS_EQUIVALENCE_THRESHOLD || normalizeKey(extracted.statement) === normalizeKey(entry.statementText)) {
      results.push({ entry, classification: "EQUIVALENT", confidence: statementSimilarity, classifierName: "deterministic-jaccard", classifierVersion: "jaccard-v1" });
      continue;
    }

    if (statementSimilarity < OBVIOUS_UNRELATED_THRESHOLD) {
      // Same subject, different aspect — not worth recording as a relationship.
      continue;
    }

    const llmResult = await classifyRelationship({ newStatement: extracted.statement, existingStatement: entry.statementText }, aiProvider);
    if (!llmResult) continue; // classifier failure — skip this pair, never fabricate a classification

    results.push({
      entry,
      classification: llmResult.classification,
      confidence: llmResult.confidence,
      classifierName: "kori-llm",
      classifierVersion: KORI_RELATIONSHIP_CLASSIFICATION_PROMPT_VERSION,
    });
  }

  return results;
}

export interface ReinforceCandidateInput {
  businessId: string;
  originSourceId: string;
  extractorName: string;
  extractorVersion: string;
  extracted: ExtractedKnowledgeCandidate;
}

export interface ReinforceCandidateResult {
  candidateId: string;
  status: PipelineCandidateStatus;
  outcome: "CREATED" | "MERGED";
}

/**
 * Converges one extracted candidate onto existing state. Merges into an
 * existing pending KnowledgeCandidate when an EQUIVALENT match is found
 * among them (reinforcement, not a new row); otherwise creates a new
 * KnowledgeCandidate. Every classified shortlist match — including matches
 * against approved KnowledgeItem/OperationalInsight rows, and matches
 * beyond the single merge target — is recorded as its own
 * KnowledgeCandidateRelationship row, so a candidate really can be
 * "equivalent to multiple candidates, contradictory to more than one
 * approved item" simultaneously (Sprint 8 review, item 1).
 */
export async function reinforceCandidate(
  input: ReinforceCandidateInput,
  aiProvider: AIProvider,
  db: PrismaClient = prisma,
): Promise<ReinforceCandidateResult> {
  const shortlist = await buildShortlist(db, input.businessId, input.extracted);
  const matches = await classifyShortlist(shortlist, input.extracted, aiProvider);

  const classifications = matches.map((m) => m.classification);
  const equivalentCandidateMatches = matches.filter((m) => m.classification === "EQUIVALENT" && m.entry.kind === "CANDIDATE");
  const mergeTarget =
    equivalentCandidateMatches.length > 0
      ? equivalentCandidateMatches.reduce((best, m) => ((m.confidence ?? 0) > (best.confidence ?? 0) ? m : best))
      : null;

  const evidenceData = {
    sourceId: input.originSourceId,
    evidenceRefType: input.extracted.evidenceRefType,
    evidenceRefId: input.extracted.evidenceRefId,
    evidenceText: input.extracted.evidenceText,
    chunkContext: input.extracted.chunkContext,
  };

  if (mergeTarget) {
    const candidateId = mergeTarget.entry.id;
    const newStatus = deriveCandidateStatus(mergeTarget.entry.currentStatus ?? "NEW", classifications);

    await db.$transaction([
      db.knowledgeCandidateEvidence.create({ data: { candidateId, ...evidenceData } }),
      db.knowledgeCandidate.update({
        where: { id: candidateId },
        data: { occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), status: newStatus },
      }),
      ...buildRelationshipCreates(db, input.businessId, candidateId, matches.filter((m) => m !== mergeTarget)),
    ]);

    return { candidateId, status: newStatus, outcome: "MERGED" };
  }

  const status = deriveCandidateStatus("NEW", classifications);
  const created = await db.knowledgeCandidate.create({
    data: {
      businessId: input.businessId,
      class: input.extracted.class,
      ...(input.extracted.class === "FACTUAL"
        ? { proposedFactualCategory: input.extracted.proposedCategory as KnowledgeCategory }
        : { proposedBehaviorCategory: input.extracted.proposedCategory as BehaviorCategory }),
      subject: input.extracted.subject,
      statement: input.extracted.statement,
      originSourceId: input.originSourceId,
      confidence: input.extracted.confidence,
      status,
      extractorName: input.extractorName,
      extractorVersion: input.extractorVersion,
      evidence: { create: [evidenceData] },
    },
  });

  if (matches.length > 0) {
    await db.$transaction(buildRelationshipCreates(db, input.businessId, created.id, matches));
  }

  return { candidateId: created.id, status, outcome: "CREATED" };
}

function buildRelationshipCreates(db: PrismaClient, businessId: string, candidateId: string, matches: ClassifiedMatch[]) {
  return matches.map((match) =>
    db.knowledgeCandidateRelationship.create({
      data: {
        businessId,
        candidateId,
        targetCandidateId: match.entry.kind === "CANDIDATE" ? match.entry.id : undefined,
        targetKnowledgeItemId: match.entry.kind === "KNOWLEDGE_ITEM" ? match.entry.id : undefined,
        targetOperationalInsightId: match.entry.kind === "OPERATIONAL_INSIGHT" ? match.entry.id : undefined,
        classification: match.classification as RelationshipClassification,
        confidence: match.confidence ?? undefined,
        classifierName: match.classifierName,
        classifierVersion: match.classifierVersion,
      },
    }),
  );
}
