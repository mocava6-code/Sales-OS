// Bridges Prisma rows into the Prisma-free extraction-input contract
// (server/knowledge/types.ts) — the one place that knows about
// ImportedMessage/ConversationEntry/WebsitePage shapes, mirroring how
// server/whatsapp/message-normalizer.ts is the one place that knows about
// Meta's raw wire format.

import type { ConversationEntry, EntryDirection, ImportedMessage, ImportedMessageRole } from "@/server/db/generated/client";
import type { ExtractionDocumentInput, ExtractionDocumentSection, ExtractionMessageInput, ExtractionMessageRole } from "./types";

const IMPORTED_MESSAGE_ROLE_MAP: Record<ImportedMessageRole, ExtractionMessageRole> = {
  BUSINESS: "BUSINESS",
  CUSTOMER: "CUSTOMER",
  UNKNOWN: "UNKNOWN",
};

export type ImportedMessageForExtraction = Pick<ImportedMessage, "id" | "resolvedRole" | "occurredAt" | "content" | "sequenceIndex">;

/**
 * Historical WhatsApp import -> shared extraction input. Ordered by
 * sequenceIndex (preserved from parsing), not occurredAt — occurredAt can be
 * null for an unparseable timestamp and must never be substituted with a
 * guess, so it can't be relied on for ordering.
 */
export function fromImportedMessages(messages: ImportedMessageForExtraction[]): ExtractionMessageInput[] {
  return [...messages]
    .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
    .map((message) => ({
      id: message.id,
      role: IMPORTED_MESSAGE_ROLE_MAP[message.resolvedRole],
      content: message.content,
      occurredAt: message.occurredAt,
      evidenceRefType: "IMPORTED_MESSAGE",
      evidenceRefId: message.id,
    }));
}

const CONVERSATION_ENTRY_ROLE_MAP: Record<EntryDirection, ExtractionMessageRole> = {
  INBOUND: "CUSTOMER",
  OUTBOUND: "BUSINESS",
};

export type ConversationEntryForExtraction = Pick<ConversationEntry, "id" | "direction" | "content" | "occurredAt">;

/**
 * Live/synced WhatsApp traffic -> shared extraction input (Sprint 8 Phase 8
 * — built for real now, not a stub, so the future live pipeline never needs
 * a second importer). direction maps directly to role: unlike a historical
 * import, a live ConversationEntry never has an UNKNOWN-role case.
 */
export function fromConversationEntries(entries: ConversationEntryForExtraction[]): ExtractionMessageInput[] {
  return entries.map((entry) => ({
    id: entry.id,
    role: CONVERSATION_ENTRY_ROLE_MAP[entry.direction],
    content: entry.content,
    occurredAt: entry.occurredAt,
    evidenceRefType: "CONVERSATION_ENTRY",
    evidenceRefId: entry.id,
  }));
}

export interface WebsitePageForExtraction {
  id: string;
  url: string;
  title: string | null;
}

/**
 * Assembles the document envelope only. Chunking a crawled page into
 * sections with their own authority context requires the page's HTML
 * structure (headings, blockquote/testimonial markers) — only available at
 * crawl time (server/knowledge/website/**) — so this adapter never
 * re-derives sections from a flattened WebsitePage.extractedText string; it
 * takes already-chunked sections as input.
 */
export function fromWebsitePageSections(
  page: WebsitePageForExtraction,
  sections: ExtractionDocumentSection[],
): ExtractionDocumentInput {
  return {
    id: page.id,
    url: page.url,
    title: page.title,
    sections,
    evidenceRefType: "WEBSITE_PAGE",
    evidenceRefId: page.id,
  };
}
