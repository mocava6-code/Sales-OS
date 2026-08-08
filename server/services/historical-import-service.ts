import { createHash } from "node:crypto";
import { prisma } from "@/server/db/client";
import type { EntryDirection, PrismaClient } from "@/server/db/generated/client";

// Populates the SAME Lead -> Conversation -> ConversationEntry models the
// live webhook pipeline (server/whatsapp/gateway.ts) writes to, from a
// parsed historical WhatsApp export instead of a live Meta payload. Never
// imports from server/whatsapp/sender.ts, queue.ts, or webhook.ts, and never
// writes WhatsAppMessageStatusEvent/PendingWhatsAppMessage — this is a pure
// backfill into the CRM, not a live-ingestion or outbound-messaging path.

// Meta's real wamid values always start with "wamid." — this prefix can
// never collide, so ConversationEntry.externalId stays one idempotency
// space shared safely between live ingestion and historical import.
export const IMPORT_EXTERNAL_ID_PREFIX = "import:sha256:";

/** Trim + collapse whitespace — deliberately NOT lowercased, WhatsApp text is case-meaningful. */
export function normalizeMessageBodyForFingerprint(content: string): string {
  return content.trim().replace(/\s+/g, " ");
}

export interface ImportFingerprintInput {
  conversationId: string;
  occurredAt: Date;
  direction: EntryDirection;
  content: string;
}

/**
 * "conversation identity + timestamp + direction + normalized body" — the
 * fingerprint re-importing the same chat must reproduce exactly so it's
 * recognized as already-imported. Deliberately excludes the parser's
 * sequenceIndex: including it would make the SAME real message get a
 * DIFFERENT fingerprint across two overlapping exports (the index shifts
 * whenever the export window changes). Accepted, documented limitation: a
 * business sending the exact same text twice in the same second collides
 * and the second copy is dropped as a duplicate — WhatsApp exports carry no
 * per-message id to disambiguate further than timestamp+direction+body.
 */
export function computeImportFingerprint(input: ImportFingerprintInput): string {
  const canonical = `${input.conversationId}|${input.occurredAt.toISOString()}|${input.direction}|${normalizeMessageBodyForFingerprint(input.content)}`;
  return IMPORT_EXTERNAL_ID_PREFIX + createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface HistoricalImportEntryInput {
  /** INBOUND | OUTBOUND only — the caller has already filtered out UNKNOWN-role messages before this function ever sees them. */
  direction: EntryDirection;
  content: string;
  /** Never null — the caller has already filtered out unparseable timestamps. */
  occurredAt: Date;
  sequenceIndex: number;
  rawLine: string;
}

export interface ImportHistoricalEntriesResult {
  conversationId: string | null;
  conversationCreated: boolean;
  createdCount: number;
  duplicateCount: number;
}

/**
 * Merges a batch of historical entries into the lead's existing WhatsApp
 * conversation (same "most recent WHATSAPP-channel conversation for this
 * lead, regardless of status" lookup as findOrCreateWhatsAppConversation,
 * server/services/conversation-service.ts), or creates one. Deliberately
 * does NOT reuse appendWhatsAppEntry: that function unconditionally
 * overwrites Conversation.lastEntryAt/lastEntryDirection/status with
 * whatever entry it just appended — correct for a single live inbound
 * message (always the newest thing that happened), wrong for a historical
 * batch that is very often OLDER than entries the conversation already has.
 */
export async function importHistoricalEntriesIntoConversation(
  businessId: string,
  leadId: string,
  entries: HistoricalImportEntryInput[],
  createdByUserId: string,
  db: PrismaClient = prisma,
): Promise<ImportHistoricalEntriesResult> {
  // Never create a Conversation with no entries — lastEntryAt/lastEntryDirection
  // are non-nullable and must reflect a real entry, never a placeholder.
  if (entries.length === 0) {
    const existing = await db.conversation.findFirst({
      where: { businessId, leadId, channel: "WHATSAPP" },
      orderBy: { lastEntryAt: "desc" },
      select: { id: true },
    });
    return { conversationId: existing?.id ?? null, conversationCreated: false, createdCount: 0, duplicateCount: 0 };
  }

  return db.$transaction(async (tx) => {
    // 1. Merge target, resolved INSIDE this transaction (not as a separate
    // pre-check) so the dedup check, the insert, and the recompute below
    // all observe the same conversation row.
    let conversation = await tx.conversation.findFirst({
      where: { businessId, leadId, channel: "WHATSAPP" },
      orderBy: { lastEntryAt: "desc" },
    });
    let created = false;
    if (!conversation) {
      conversation = await tx.conversation.create({
        data: {
          businessId,
          leadId,
          channel: "WHATSAPP",
          source: "HISTORICAL_IMPORT", // only set when THIS call creates the thread — see schema.prisma's doc comment on this enum value
          status: "NEEDS_REPLY",
          lastEntryAt: entries[0].occurredAt, // provisional — step 5 below recomputes the true value
          lastEntryDirection: entries[0].direction,
          createdByUserId, // a human (the importing OWNER) triggered this creation, same rule as MANUAL_PASTE/MANUAL_ENTRY conversations
          whatsappPhoneNumberId: null, // not tied to any live-registered WhatsApp number
        },
      });
      created = true;
    }

    // 2. Compute each entry's fingerprint now that conversation.id is known.
    const withFingerprints = entries.map((e) => ({
      ...e,
      externalId: computeImportFingerprint({
        conversationId: conversation!.id,
        occurredAt: e.occurredAt,
        direction: e.direction,
        content: e.content,
      }),
    }));

    // 3. Bulk pre-check which fingerprints already exist — MUST happen
    // before any insert is attempted. Postgres aborts the ENTIRE
    // transaction the instant one statement violates a unique constraint;
    // every later statement in the same transaction then fails until a
    // rollback, with no per-statement recovery (no SAVEPOINT in Prisma's
    // transaction API). The catch-P2002 pattern used elsewhere for a single
    // entry (conversation-service.ts's appendWhatsAppEntry, gateway.ts,
    // phone-numbers.ts) only works there because it's always ONE entry per
    // $transaction call — copying it into a batch of N historical rows in
    // ONE transaction would let row 5's collision silently doom rows 6..N.
    // Filtering in application code, before the insert statement is ever
    // issued, avoids this entirely.
    const existing = await tx.conversationEntry.findMany({
      where: { externalId: { in: withFingerprints.map((e) => e.externalId) } },
      select: { externalId: true },
    });
    const existingIds = new Set(existing.map((e) => e.externalId));
    const toCreate = withFingerprints.filter((e) => !existingIds.has(e.externalId));
    const duplicateCount = withFingerprints.length - toCreate.length;

    // 4. Insert the remainder as one statement. skipDuplicates is a race
    // backstop only (e.g. the same OWNER double-submitting in two tabs) —
    // not the primary dedup mechanism, since it can't report which rows it
    // skipped; step 3 already computed accurate created/duplicate counts
    // for the OWNER-facing summary.
    let createdCount = 0;
    if (toCreate.length > 0) {
      const result = await tx.conversationEntry.createMany({
        data: toCreate.map((e) => ({
          conversationId: conversation!.id,
          direction: e.direction,
          content: e.content,
          // WhatsApp .txt exports carry no real media — "<Media omitted>"
          // is already plain content text from the tokenizer
          // (server/knowledge/whatsapp-import/tokenizer.ts); mediaId/
          // mediaMimeType/etc. all stay null, a documented v1 limitation.
          messageType: "TEXT",
          occurredAt: e.occurredAt,
          externalId: e.externalId,
          rawPayload: { imported: true, sequenceIndex: e.sequenceIndex, rawLine: e.rawLine },
        })),
        skipDuplicates: true,
      });
      createdCount = result.count;
    }

    // 5. Recompute lastEntryAt/lastEntryDirection/status from the TRUE max
    // across the conversation's FULL current entry set — live-ingested +
    // every prior import + what was just inserted — never an unconditional
    // overwrite (appendWhatsAppEntry's shape, unsafe here) and never a
    // conditional "only advance if newer" check either (that's correct on
    // a first import but not truly idempotent on re-import — a plain
    // MAX(occurredAt) query is the only formulation that's a genuine no-op
    // the second time).
    const latest = await tx.conversationEntry.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, direction: true },
    });
    // Guaranteed non-null: either the conversation pre-existed (>=1 prior
    // entry) or this call itself just created >=1 row (entries.length > 0 was checked above).
    await tx.conversation.update({
      where: { id: conversation.id },
      data: {
        lastEntryAt: latest!.occurredAt,
        lastEntryDirection: latest!.direction,
        status: latest!.direction === "INBOUND" ? "NEEDS_REPLY" : "WAITING_ON_CUSTOMER",
      },
    });

    return { conversationId: conversation.id, conversationCreated: created, createdCount, duplicateCount };
  });
}
