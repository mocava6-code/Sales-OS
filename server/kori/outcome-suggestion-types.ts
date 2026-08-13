import type { LostReason } from "@/lib/validations/outcome";

export interface OutcomeSuggestionConversationEntry {
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  occurredAt: Date;
}

export interface OutcomeSuggestion {
  suggestedOutcomeType: "SALE_CLOSED" | "SALE_LOST" | "NOT_AN_OPPORTUNITY";
  suggestedLostReason: LostReason | null;
  reasoning: string;
}
