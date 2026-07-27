import type {
  ConversationAnalysisCapability,
  DecisionReasoningCapability,
  DraftGenerationCapability,
  EmbeddingCapability,
  KnowledgeExtractionCapability,
  SpeechCapability,
  VisionCapability,
} from "./capabilities";

export interface AIProviderCapabilities {
  conversationAnalysis?: ConversationAnalysisCapability;
  decisionReasoning?: DecisionReasoningCapability;
  knowledgeExtraction?: KnowledgeExtractionCapability;
  draftGeneration?: DraftGenerationCapability;
  vision?: VisionCapability;
  embedding?: EmbeddingCapability;
  speech?: SpeechCapability;
}

/**
 * A vendor-agnostic AI provider — represents "a vendor that exposes some set
 * of AI capabilities," not a single language model. A provider may expose
 * conversation analysis today and vision/embedding/speech later without
 * this interface changing shape; callers depend only on the capability they
 * need (see capabilities.ts), never on a vendor's own method names or
 * response types.
 */
export interface AIProvider {
  readonly name: string;
  readonly modelName: string;
  readonly capabilities: AIProviderCapabilities;
}
