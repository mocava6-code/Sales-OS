import type { KnowledgeSnippet } from "./knowledge-source";
import type { ProviderResult } from "./schema";
import type {
  CustomerIdentification,
  DraftResponse,
  EngineWarning,
  Evidence,
  Fact,
  FactSet,
  Inference,
  InferenceSet,
  MissingFieldEntry,
  NormalizedMessage,
  ObjectionSignal,
} from "./types";

// The hallucination gate. Every populated fact, inference, objection, and
// recommendation must trace to real, locatable evidence — checked here, not
// merely instructed in a prompt. Anything that fails is either demoted to
// unknown (no valid evidence at all) or kept with reduced confidence and a
// trimmed evidence list (some, but not all, evidence was valid). Nothing
// unsupported passes through silently.

export interface GroundingContext {
  messages: NormalizedMessage[];
  knowledgeSnippets: KnowledgeSnippet[];
}

export interface GroundingValidationOutcome {
  customerIdentification: CustomerIdentification;
  facts: FactSet;
  inferences: InferenceSet;
  objections: ObjectionSignal[];
  draftResponse: DraftResponse | null;
  missingInformation: MissingFieldEntry[];
  warnings: EngineWarning[];
}

const MESSAGE_EVIDENCE_ID = /^message-(\d+)$/;

function isEvidenceValid(evidence: Evidence, context: GroundingContext): boolean {
  if (!evidence.excerpt || evidence.excerpt.trim().length === 0) {
    return false;
  }

  if (evidence.sourceType === "conversation_message") {
    const match = MESSAGE_EVIDENCE_ID.exec(evidence.sourceId);
    if (!match) return false;
    const message = context.messages[Number(match[1])];
    if (!message) return false;
    return message.content.toLowerCase().includes(evidence.excerpt.trim().toLowerCase());
  }

  if (evidence.sourceType === "knowledge_item") {
    const snippet = context.knowledgeSnippets.find((s) => s.id === evidence.sourceId);
    if (!snippet) return false;
    return snippet.content.toLowerCase().includes(evidence.excerpt.trim().toLowerCase());
  }

  // "customer_history" — no customer-history index exists in this phase.
  // Every reference to it is unsupported until that source is implemented.
  return false;
}

function partitionEvidence(evidence: Evidence[], context: GroundingContext) {
  return {
    valid: evidence.filter((e) => isEvidenceValid(e, context)),
    invalidCount: evidence.filter((e) => !isEvidenceValid(e, context)).length,
  };
}

function validateScoredField<T>(
  fieldPath: string,
  field: Fact<T> | Inference<T>,
  context: GroundingContext,
  missingInformation: MissingFieldEntry[],
  warnings: EngineWarning[],
): Fact<T> | Inference<T> {
  if (field.value === null) return field;

  const { valid, invalidCount } = partitionEvidence(field.evidence, context);

  if (valid.length === 0) {
    warnings.push({
      code: "GROUNDING_NO_VALID_EVIDENCE",
      message: `"${fieldPath}" had no verifiable evidence and was demoted to unknown.`,
      field: fieldPath,
      severity: "warning",
    });
    missingInformation.push({ field: fieldPath, reason: "no verifiable evidence" });
    return { ...field, value: null, confidence: 0, evidence: [] };
  }

  if (invalidCount > 0) {
    const penalty = invalidCount / field.evidence.length;
    warnings.push({
      code: "GROUNDING_PARTIAL_EVIDENCE",
      message: `"${fieldPath}" had ${invalidCount} unverifiable evidence entr${invalidCount === 1 ? "y" : "ies"}; confidence reduced.`,
      field: fieldPath,
      severity: "warning",
    });
    return { ...field, evidence: valid, confidence: Math.max(0, field.confidence * (1 - penalty)) };
  }

  return { ...field, evidence: valid };
}

function validateFactSet(
  facts: FactSet,
  context: GroundingContext,
  missingInformation: MissingFieldEntry[],
  warnings: EngineWarning[],
): FactSet {
  return {
    customerName: validateScoredField("facts.customerName", facts.customerName, context, missingInformation, warnings) as Fact<string>,
    customerContact: validateScoredField("facts.customerContact", facts.customerContact, context, missingInformation, warnings) as Fact<string>,
    vehicleBrand: validateScoredField("facts.vehicleBrand", facts.vehicleBrand, context, missingInformation, warnings) as Fact<string>,
    vehicleModel: validateScoredField("facts.vehicleModel", facts.vehicleModel, context, missingInformation, warnings) as Fact<string>,
    vehicleYear: validateScoredField("facts.vehicleYear", facts.vehicleYear, context, missingInformation, warnings) as Fact<number>,
    city: validateScoredField("facts.city", facts.city, context, missingInformation, warnings) as Fact<string>,
    quantity: validateScoredField("facts.quantity", facts.quantity, context, missingInformation, warnings) as Fact<number>,
    productRequested: validateScoredField("facts.productRequested", facts.productRequested, context, missingInformation, warnings) as Fact<string>,
  };
}

function validateInferenceSet(
  inferences: InferenceSet,
  context: GroundingContext,
  missingInformation: MissingFieldEntry[],
  warnings: EngineWarning[],
): InferenceSet {
  return {
    customerType: validateScoredField(
      "inferences.customerType",
      inferences.customerType,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["customerType"],
    productFamily: validateScoredField(
      "inferences.productFamily",
      inferences.productFamily,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["productFamily"],
    compatibility: validateScoredField(
      "inferences.compatibility",
      inferences.compatibility,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["compatibility"],
    buyingIntent: validateScoredField(
      "inferences.buyingIntent",
      inferences.buyingIntent,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["buyingIntent"],
    sentiment: validateScoredField(
      "inferences.sentiment",
      inferences.sentiment,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["sentiment"],
    estimatedProbabilityOfPurchase: validateScoredField(
      "inferences.estimatedProbabilityOfPurchase",
      inferences.estimatedProbabilityOfPurchase,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["estimatedProbabilityOfPurchase"],
    estimatedDealValue: validateScoredField(
      "inferences.estimatedDealValue",
      inferences.estimatedDealValue,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["estimatedDealValue"],
    recommendedNextAction: validateScoredField(
      "inferences.recommendedNextAction",
      inferences.recommendedNextAction,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["recommendedNextAction"],
    aiPriority: validateScoredField(
      "inferences.aiPriority",
      inferences.aiPriority,
      context,
      missingInformation,
      warnings,
    ) as InferenceSet["aiPriority"],
  };
}

function validateCustomerIdentification(
  identification: CustomerIdentification,
  context: GroundingContext,
  missingInformation: MissingFieldEntry[],
  warnings: EngineWarning[],
): CustomerIdentification {
  const hasClaim = identification.isExistingCustomer || identification.matchedLeadId !== null;
  if (!hasClaim) return identification;

  const { valid, invalidCount } = partitionEvidence(identification.matchEvidence, context);

  if (valid.length === 0) {
    warnings.push({
      code: "GROUNDING_NO_VALID_EVIDENCE",
      message: `"customerIdentification" had no verifiable evidence and was demoted to unknown.`,
      field: "customerIdentification",
      severity: "warning",
    });
    missingInformation.push({ field: "customerIdentification.matchedLeadId", reason: "no verifiable evidence" });
    return { isExistingCustomer: false, matchedLeadId: null, matchConfidence: 0, matchEvidence: [] };
  }

  if (invalidCount > 0) {
    const penalty = invalidCount / identification.matchEvidence.length;
    warnings.push({
      code: "GROUNDING_PARTIAL_EVIDENCE",
      message: `"customerIdentification" had ${invalidCount} unverifiable evidence entr${invalidCount === 1 ? "y" : "ies"}; confidence reduced.`,
      field: "customerIdentification",
      severity: "warning",
    });
    return {
      ...identification,
      matchEvidence: valid,
      matchConfidence: Math.max(0, identification.matchConfidence * (1 - penalty)),
    };
  }

  return { ...identification, matchEvidence: valid };
}

function validateObjections(objections: ObjectionSignal[], context: GroundingContext, warnings: EngineWarning[]): ObjectionSignal[] {
  const result: ObjectionSignal[] = [];

  for (const objection of objections) {
    const { valid, invalidCount } = partitionEvidence(objection.evidence, context);

    if (valid.length === 0) {
      warnings.push({
        code: "GROUNDING_NO_VALID_EVIDENCE",
        message: `Objection "${objection.objection}" had no verifiable evidence and was dropped.`,
        field: "objections",
        severity: "warning",
      });
      continue;
    }

    if (invalidCount > 0) {
      const penalty = invalidCount / objection.evidence.length;
      warnings.push({
        code: "GROUNDING_PARTIAL_EVIDENCE",
        message: `Objection "${objection.objection}" had ${invalidCount} unverifiable evidence entr${invalidCount === 1 ? "y" : "ies"}; confidence reduced.`,
        field: "objections",
        severity: "warning",
      });
      result.push({ ...objection, evidence: valid, confidence: Math.max(0, objection.confidence * (1 - penalty)) });
      continue;
    }

    result.push({ ...objection, evidence: valid });
  }

  return result;
}

function validateDraftResponse(
  draftResponse: DraftResponse | null,
  context: GroundingContext,
  warnings: EngineWarning[],
): DraftResponse | null {
  if (!draftResponse) return null;

  const { valid, invalidCount } = partitionEvidence(draftResponse.evidence, context);

  if (valid.length === 0) {
    warnings.push({
      code: "GROUNDING_NO_VALID_EVIDENCE",
      message: `"draftResponse" had no verifiable evidence and was dropped.`,
      field: "draftResponse",
      severity: "warning",
    });
    return null;
  }

  if (invalidCount > 0) {
    warnings.push({
      code: "GROUNDING_PARTIAL_EVIDENCE",
      message: `"draftResponse" had ${invalidCount} unverifiable evidence entr${invalidCount === 1 ? "y" : "ies"}; kept only the verifiable ones.`,
      field: "draftResponse",
      severity: "warning",
    });
  }

  return { ...draftResponse, evidence: valid };
}

export function validateGrounding(providerResult: ProviderResult, context: GroundingContext): GroundingValidationOutcome {
  const warnings: EngineWarning[] = [];
  const missingInformation: MissingFieldEntry[] = [...providerResult.missingInformation];

  const customerIdentification = validateCustomerIdentification(
    providerResult.customerIdentification,
    context,
    missingInformation,
    warnings,
  );
  const facts = validateFactSet(providerResult.facts, context, missingInformation, warnings);
  const inferences = validateInferenceSet(providerResult.inferences, context, missingInformation, warnings);
  const objections = validateObjections(providerResult.objections, context, warnings);
  const draftResponse = validateDraftResponse(providerResult.draftResponse, context, warnings);

  return { customerIdentification, facts, inferences, objections, draftResponse, missingInformation, warnings };
}
