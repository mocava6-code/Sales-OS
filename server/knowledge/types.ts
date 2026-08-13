// Knowledge Ingestion v1 — the shared extraction-input vocabulary. Prisma-free
// by design (same discipline as server/domain-events/types.ts): every
// ingestion source (WhatsApp import today, live ConversationEntry traffic
// later per Sprint 8 Phase 8, website crawl pages) converges on these two
// shapes before the knowledge-extraction pipeline (server/knowledge/extract.ts)
// ever runs. Building this adapter layer before either concrete pipeline is
// the point — it's what keeps the historical importer from being a
// throwaway one-off.

/**
 * Where a piece of extraction input's evidence can be traced back to. Mirrors
 * the Prisma EvidenceRefType enum's values without importing it — this file
 * is read by prompt-construction code that has no reason to depend on the DB
 * client, same reasoning as domain-events/types.ts.
 */
export type ExtractionEvidenceRefType = "IMPORTED_MESSAGE" | "WEBSITE_PAGE" | "CONVERSATION_ENTRY";

/** Mirrors the Prisma ImportedMessageRole enum's values. */
export type ExtractionMessageRole = "BUSINESS" | "CUSTOMER" | "UNKNOWN";

/**
 * One conversational turn, regardless of whether it came from a parsed
 * WhatsApp export or (later) a live ConversationEntry. `occurredAt` is
 * nullable — an unparseable historical timestamp is never fabricated, and
 * the extraction prompt must be able to say so rather than silently treating
 * it as "now".
 */
export interface ExtractionMessageInput {
  /** Stable within one extraction run — used for citation numbering in the prompt. */
  id: string;
  role: ExtractionMessageRole;
  content: string;
  occurredAt: Date | null;
  evidenceRefType: ExtractionEvidenceRefType;
  evidenceRefId: string;
}

/** Mirrors the Prisma WebsitePageContext enum's values. */
export type ExtractionSectionContext = "PRODUCT" | "SERVICE" | "FAQ" | "POLICY" | "MARKETING" | "TESTIMONIAL" | "UNKNOWN";

/**
 * One section/chunk of a crawled page, each carrying its OWN authority
 * context — a TESTIMONIAL blockquote embedded in an otherwise PRODUCT page
 * must never inherit PRODUCT-level authority just because of where it sits
 * (Sprint 8 review, item 3). WebsitePage.pageContext is only ever the
 * page-wide dominant label; this is what the extraction prompt actually
 * reads section-by-section.
 */
export interface ExtractionDocumentSection {
  id: string;
  context: ExtractionSectionContext;
  heading: string | null;
  text: string;
  /**
   * The best available structural title for THIS section specifically — a
   * product card's own title/heading, preferred by deterministic rules over
   * a generic vehicle-dictionary match (Sprint 8 quality-fix review, item 2).
   * Falls back to `heading` when no more specific card title exists.
   */
  subjectHint?: string | null;
  /**
   * False for a section that could only be produced via unstructured,
   * size-bounded fallback splitting (no product card, no clean heading
   * boundary, no natural paragraph break small enough on its own) — a
   * deterministic rule must never treat this as a safely groundable single
   * fact, even if it happens to match a keyword (Sprint 8 quality-fix
   * review, item 1). LLM extraction is unaffected — it still reads
   * unreliable sections normally, since a human/AI can judge context an
   * exact-match rule can't.
   */
  reliable: boolean;
}

/** One crawled page, pre-chunked into sections before extraction. */
export interface ExtractionDocumentInput {
  id: string;
  url: string;
  title: string | null;
  sections: ExtractionDocumentSection[];
  evidenceRefType: "WEBSITE_PAGE";
  evidenceRefId: string;
}

/** One extraction run's full input — either a conversation's turns or one document's sections, never both. */
export type ExtractionInput =
  | { kind: "CONVERSATION"; messages: ExtractionMessageInput[] }
  | { kind: "DOCUMENT"; document: ExtractionDocumentInput };
