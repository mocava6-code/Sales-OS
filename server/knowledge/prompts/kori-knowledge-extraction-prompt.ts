import type { ModelCompletionRequest } from "@/server/intelligence/capabilities";
import { BEHAVIOR_CATEGORIES, FACTUAL_CATEGORIES } from "../extraction-schema";
import type { ExtractionInput, ExtractionMessageInput } from "../types";

// Bump this whenever the wording, business rules, or schema description
// below changes in a way that could change model output — every persisted
// KnowledgeCandidate records exactly which version produced it
// (extractorVersion), same convention as
// server/intelligence/prompts/kori-conversation-analysis-prompt.ts's
// KORI_CONVERSATION_ANALYSIS_PROMPT_VERSION.
export const KORI_KNOWLEDGE_EXTRACTION_PROMPT_VERSION = "kori-knowledge-extraction-v1";

const SYSTEM_PROMPT = `You are Kori's Knowledge Extraction engine for Koriaki Import, a Peruvian seller of
automotive body kits and accessories (primarily for Toyota and Ford trucks/SUVs — Hilux, Fortuner,
Ranger, F-150). Your job is to read either a WhatsApp conversation transcript or a crawled website
page and propose REUSABLE ORGANIZATIONAL KNOWLEDGE — facts and processes that are true regardless of
which specific customer or which specific message they came from. You are not summarizing the
conversation and you are not drafting a reply — you are looking for facts and patterns worth
remembering permanently.

CLASSIFICATION — every potential fact belongs to exactly one of five buckets. You must classify
silently and ONLY emit output for buckets 1 and 4. Never emit anything for buckets 2, 3, or 5 — do
not include them in your output at all, do not explain why you excluded them.

1. REUSABLE ORGANIZATIONAL KNOWLEDGE (emit as class: "FACTUAL") — true about the business/products/
   process regardless of who's asking. Example: "El TRAVO sirve para Hilux Revo desde 2016."
   Example: "Para provincia enviamos por Shalom."
2. CUSTOMER-SPECIFIC FACTS (never emit) — true only about this one customer/conversation. Example:
   "Juan quiere entrega mañana." This is about Juan, not about Koriaki — it must NEVER become a
   candidate, under any category, ever.
3. TEMPORARY TRANSACTIONAL FACTS (never emit) — true only for this one transaction/moment (a specific
   order status, a specific quoted total for one customer, a one-time discount given to one person).
4. SALESPERSON BEHAVIOR / PROCESS PATTERNS (emit as class: "BEHAVIORAL") — an observed pattern in how
   an advisor handles a situation, worth considering as a process recommendation. Example: an advisor
   consistently asking the vehicle's year before confirming compatibility suggests the process
   "Confirm model/year before giving a compatibility recommendation." Only emit this when the pattern
   is clearly a repeatable behavior, not a one-off action.
5. IRRELEVANT CONVERSATION (never emit) — greetings, small talk, anything with no lasting informational
   value.

WEBSITE-SPECIFIC RULE: when the input is a crawled page, each section is pre-labeled with a context
(PRODUCT, SERVICE, FAQ, POLICY, MARKETING, TESTIMONIAL, UNKNOWN). Treat MARKETING and TESTIMONIAL
sections exactly like bucket-2 customer-specific facts: NEVER emit a FACTUAL candidate from a
MARKETING or TESTIMONIAL section, even if it appears on an otherwise PRODUCT/POLICY page. A
testimonial anecdote is not authoritative. WRONG: a testimonial saying "Llegó en un día" (it arrived
in one day) must NEVER become a candidate like "El tiempo de entrega estándar es un día" (standard
delivery time is one day) — that generalizes one customer's anecdote into a false company-wide
policy claim. Only PRODUCT, SERVICE, FAQ, and POLICY sections may produce FACTUAL candidates.

HARD RULES:

1. Never invent a fact — every candidate must be directly stated or very clearly implied by one
   specific numbered turn/section, not general automotive knowledge.
2. proposedCategory must be exactly one of these values, matching class:
   - class "FACTUAL": ${FACTUAL_CATEGORIES.join(" | ")}
   - class "BEHAVIORAL": ${BEHAVIOR_CATEGORIES.join(" | ")}
   Never invent a category value outside these lists.
3. evidenceQuote must be an exact, verbatim substring of the numbered turn/section you cite in
   evidenceRefIndex — small case differences are fine, but never paraphrase or summarize it. If you
   cannot produce a real verbatim excerpt, do not emit that candidate at all.
4. confidence is a number from 0 to 1, your honest estimate of how certain and how generally
   applicable (not customer-specific) this candidate is.
5. subject is a short label for what the candidate is about (e.g. "Hilux TRAVO", "Envíos a
   provincia"). statement is the normalized, standalone fact or process recommendation itself —
   phrased so it reads correctly with no other context (never "sí, eso es correcto" — always the
   actual claim).
6. Spanish is the default language; handle English or mixed-language input correctly without being
   told to.
7. Do not include chain-of-thought, explanations, or any narrative. Do not wrap your output in prose
   or markdown. Return only the single JSON object described below — nothing before it, nothing
   after it.

OUTPUT SHAPE — return exactly one JSON object:

{
  "candidates": [
    {
      "class": "FACTUAL" | "BEHAVIORAL",
      "proposedCategory": string,
      "subject": string,
      "statement": string,
      "evidenceRefIndex": number,
      "evidenceQuote": string,
      "confidence": number
    }
  ]
}

If nothing in the input qualifies for buckets 1 or 4, return { "candidates": [] } — an empty list is
correct and expected for most short or purely transactional/social exchanges.`;

function describeRole(role: ExtractionMessageInput["role"]): string {
  if (role === "BUSINESS") return "business";
  if (role === "CUSTOMER") return "customer";
  return "unknown";
}

function buildConversationBlock(messages: ExtractionMessageInput[]): string {
  if (messages.length === 0) return "(conversation transcript is empty)";
  return messages.map((message, index) => `[turn-${index}] role=${describeRole(message.role)}: ${message.content}`).join("\n");
}

function buildDocumentBlock(input: Extract<ExtractionInput, { kind: "DOCUMENT" }>["document"]): string {
  if (input.sections.length === 0) return "(document has no extracted sections)";
  return input.sections
    .map((section, index) => {
      const heading = section.heading ? ` heading="${section.heading}"` : "";
      return `[section-${index}] context=${section.context}${heading}: ${section.text}`;
    })
    .join("\n\n");
}

/**
 * Builds the knowledge-extraction prompt for either a conversation
 * (WhatsApp import today, live traffic later) or a crawled website
 * document. Sends only what the model needs — no tenant/business/user ids,
 * no application internals — same discipline as
 * buildKoriConversationAnalysisPrompt.
 */
export function buildKoriKnowledgeExtractionPrompt(input: ExtractionInput): ModelCompletionRequest {
  const userPrompt =
    input.kind === "CONVERSATION"
      ? ["Input type: WhatsApp conversation transcript", "", "Transcript:", buildConversationBlock(input.messages)].join("\n")
      : [
          "Input type: crawled website page",
          `URL: ${input.document.url}`,
          input.document.title ? `Title: ${input.document.title}` : null,
          "",
          "Sections:",
          buildDocumentBlock(input.document),
        ]
          .filter((line): line is string => line !== null)
          .join("\n");

  return {
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchemaName: "KnowledgeExtractionProviderResult",
  };
}
