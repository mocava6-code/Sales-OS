import type { EngineWarning, Evidence, Inference, NormalizedMessage } from "../types";
import type { CitableKnowledgeItem } from "./knowledge-items";
import type { CommercialProfileTrait, CustomerProfileInference, CustomerProfileTraitProposal, DecisionProposal } from "./types";

// The Decision Engine's hallucination gate — analogous to
// grounding-validator.ts in the parent engine, adapted for two extra
// concerns specific to commercial decisions: (1) evidence may cite a
// pre-verified Conversation Intelligence fact or a supplied business fact,
// not just a raw message, and (2) a decision's *recommendation/reasoning
// text* itself can make an unsupported claim even when its evidence array
// looks fine — a risk that doesn't exist in a fixed-field extraction schema.

export interface DecisionGroundingContext {
  /** Present only if the caller supplied recentMessages — message-N evidence is otherwise unverifiable. */
  messages?: NormalizedMessage[];
  knowledgeItems: CitableKnowledgeItem[];
}

function isEvidenceValid(evidence: Evidence, context: DecisionGroundingContext): boolean {
  if (!evidence.excerpt || evidence.excerpt.trim().length === 0) return false;

  if (evidence.sourceType === "conversation_message") {
    if (!context.messages) return false;
    const match = /^message-(\d+)$/.exec(evidence.sourceId);
    if (!match) return false;
    const message = context.messages[Number(match[1])];
    if (!message) return false;
    return message.content.toLowerCase().includes(evidence.excerpt.trim().toLowerCase());
  }

  if (evidence.sourceType === "knowledge_item") {
    const item = context.knowledgeItems.find((k) => k.id === evidence.sourceId);
    if (!item) return false;
    return item.content.toLowerCase().includes(evidence.excerpt.trim().toLowerCase());
  }

  // "customer_history" — no customer-history index exists in this phase.
  return false;
}

// --- Unsupported-claim detection --------------------------------------------
//
// Two tiers, both deterministic (regex-based, not a second AI call):
//   - "soft" — the text merely mentions a protected category (price, stock,
//     ...) with no knowledge_item-grounded evidence anywhere in the
//     proposal. Recoverable: flagged via missingInformation + a warning: the
//     decision survives, and the policy evaluator will force
//     HUMAN_INFORMATION_REQUIRED downstream.
//   - "hard" — the text states a *concrete* fabricated value (an actual
//     currency amount, an explicit "yes it's compatible", a specific
//     delivery duration, ...) with no grounding. Severe enough that the
//     proposal is retyped to ESCALATE_TO_HUMAN and its recommendation text
//     is replaced — never silently dropped, always visible via a warning.

const PROTECTED_CATEGORY_PATTERNS: { category: string; pattern: RegExp }[] = [
  { category: "price", pattern: /\b(precio|costo|cuesta|vale|price|cost)\b/i },
  { category: "stock", pattern: /\b(stock|disponibilidad|disponible|inventario|inventory|availability)\b/i },
  { category: "compatibility", pattern: /\b(compatib\w*|encaja|fits?)\b/i },
  { category: "shipping_time", pattern: /\b(env[íi]o|entrega|shipping|delivery)\b/i },
  { category: "delivery_promise", pattern: /\b(llegar[áa]|arrives?|estar[áa]\s+(listo|disponible))\b/i },
  { category: "discount_authorization", pattern: /\b(descuento|rebaja|discount|promo\w*)\b/i },
  { category: "payment_conditions", pattern: /\b(financiamiento|cuotas|payment plan|installments)\b/i },
  { category: "warranty", pattern: /\b(garant[íi]a|warranty)\b/i },
  { category: "company_policy", pattern: /\bpol[íi]tica\b/i },
];

const HARD_VIOLATION_PATTERNS: { category: string; pattern: RegExp }[] = [
  { category: "price", pattern: /(\$|S\/\.?|USD|PEN)\s?\d+(?:[.,]\d+)?/i },
  {
    category: "stock",
    pattern: /\b\d+\s*(unidades|units|piezas|pieces)\b|\b(hay|tenemos|we have)\s+(stock|disponible|available)\b/i,
  },
  { category: "compatibility", pattern: /\b(s[íi],?\s*(es\s+)?compatible|yes,?\s*it'?s\s+compatible|100%\s*compatible)\b/i },
  { category: "shipping_time", pattern: /\b\d+\s*(d[íi]as|days|horas|hours|semanas|weeks)\b/i },
];

const RISKY_FRAMING_PATTERNS: RegExp[] = [
  /\b(te prometo|garantizo|i promise|i guarantee)\b/i,
  /\b(última oportunidad|solo hoy|only today|limited time|now or never|se acaba)\b/i,
];

function findCategoryMatches(text: string, patterns: { category: string; pattern: RegExp }[]): string[] {
  return patterns.filter(({ pattern }) => pattern.test(text)).map(({ category }) => category);
}

export interface ValidatedDecisionProposal {
  proposal: DecisionProposal;
  warnings: EngineWarning[];
  hasUngroundedProtectedClaim: boolean;
  hasCommerciallyRiskyFraming: boolean;
}

export function validateDecisionProposal(raw: DecisionProposal, context: DecisionGroundingContext): ValidatedDecisionProposal {
  const warnings: EngineWarning[] = [];

  // Ground the evidence array itself first.
  const validEvidence = raw.evidence.filter((e) => isEvidenceValid(e, context));
  const invalidEvidenceCount = raw.evidence.length - validEvidence.length;
  if (invalidEvidenceCount > 0) {
    warnings.push({
      code: "GROUNDING_PARTIAL_EVIDENCE",
      message: `Decision "${raw.title}" had ${invalidEvidenceCount} unverifiable evidence entr${invalidEvidenceCount === 1 ? "y" : "ies"}; they were dropped.`,
      severity: "warning",
    });
  }

  const combinedText = `${raw.recommendation} ${raw.reasoning}`;
  const hasKnowledgeEvidence = validEvidence.some((e) => e.sourceType === "knowledge_item");
  const hasCommerciallyRiskyFraming = RISKY_FRAMING_PATTERNS.some((pattern) => pattern.test(combinedText));

  let missingInformation = [...raw.missingInformation];
  let hasUngroundedProtectedClaim = false;

  for (const category of findCategoryMatches(combinedText, PROTECTED_CATEGORY_PATTERNS)) {
    if (hasKnowledgeEvidence) continue;
    hasUngroundedProtectedClaim = true;
    if (!missingInformation.some((m) => m.field === category)) {
      missingInformation = [...missingInformation, { field: category, reason: "mentioned without a verified supporting fact" }];
    }
    warnings.push({
      code: "UNSUPPORTED_CLAIM_CATEGORY",
      message: `Decision "${raw.title}" references "${category}" without a verified supporting fact.`,
      field: category,
      severity: "warning",
    });
  }

  let proposal: DecisionProposal = { ...raw, evidence: validEvidence, missingInformation };

  for (const category of findCategoryMatches(combinedText, HARD_VIOLATION_PATTERNS)) {
    if (hasKnowledgeEvidence) continue;
    hasUngroundedProtectedClaim = true;
    warnings.push({
      code: "UNSUPPORTED_DECISION_CLAIM",
      message: `Decision "${raw.title}" states a specific ${category} claim with no verified evidence — escalated automatically.`,
      field: category,
      severity: "error",
    });
    proposal = {
      ...proposal,
      type: "ESCALATE_TO_HUMAN",
      recommendation: `Do not share this ${category} detail with the customer — it is not verified. Escalate to a human advisor or request verified information before responding.`,
      reasoning: `${proposal.reasoning}\n\n[Kori] Escalated automatically: the original recommendation stated a specific ${category} claim with no verified supporting fact.`,
      missingInformation: proposal.missingInformation.some((m) => m.field === category)
        ? proposal.missingInformation
        : [...proposal.missingInformation, { field: category, reason: "unverified — original claim was not grounded" }],
    };
  }

  return { proposal, warnings, hasUngroundedProtectedClaim, hasCommerciallyRiskyFraming };
}

export interface ValidatedCustomerProfile {
  profile?: CustomerProfileInference;
  warnings: EngineWarning[];
}

export function validateCustomerProfileTraits(
  traits: CustomerProfileTraitProposal[],
  context: DecisionGroundingContext,
): ValidatedCustomerProfile {
  if (traits.length === 0) return { profile: undefined, warnings: [] };

  const warnings: EngineWarning[] = [];
  const validated: Inference<CommercialProfileTrait>[] = [];

  for (const trait of traits) {
    const validEvidence = trait.evidence.filter((e) => isEvidenceValid(e, context));

    if (validEvidence.length === 0) {
      warnings.push({
        code: "GROUNDING_NO_VALID_EVIDENCE",
        message: `Customer profile trait "${trait.trait}" had no verifiable evidence and was dropped as a hypothesis.`,
        field: `customerProfile.${trait.trait}`,
        severity: "warning",
      });
      continue; // an ungrounded trait guess is dropped, not kept as a confusing null entry
    }

    if (validEvidence.length < trait.evidence.length) {
      const invalidCount = trait.evidence.length - validEvidence.length;
      const penalty = invalidCount / trait.evidence.length;
      warnings.push({
        code: "GROUNDING_PARTIAL_EVIDENCE",
        message: `Customer profile trait "${trait.trait}" had ${invalidCount} unverifiable evidence entr${invalidCount === 1 ? "y" : "ies"}; confidence reduced.`,
        field: `customerProfile.${trait.trait}`,
        severity: "warning",
      });
      validated.push({
        kind: "inference",
        value: trait.trait,
        confidence: Math.max(0, trait.confidence * (1 - penalty)),
        evidence: validEvidence,
        reasoning: trait.reasoning,
      });
      continue;
    }

    validated.push({
      kind: "inference",
      value: trait.trait,
      confidence: trait.confidence,
      evidence: validEvidence,
      reasoning: trait.reasoning,
    });
  }

  return { profile: validated.length > 0 ? { traits: validated } : undefined, warnings };
}
