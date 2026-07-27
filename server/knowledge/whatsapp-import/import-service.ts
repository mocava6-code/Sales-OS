// Persistence for a WhatsApp conversation import — KnowledgeSource +
// ImportedConversation + ImportedMessage. Parsing (parser.ts) is pure and
// has no DB dependency; this is the one place that writes its output.

import { prisma } from "@/server/db/client";
import { Prisma } from "@/server/db/generated/client";
import type {
  ExternalConversationSource,
  ImportedConversationResolutionMethod,
  PrismaClient,
} from "@/server/db/generated/client";
import type { PrismaClientOrTransaction } from "@/server/persistence/prisma/client";
import type { ImportDateOrder, ParseWhatsAppExportResult } from "./parser";

type ResolvedParseResult = Extract<ParseWhatsAppExportResult, { needsParticipantResolution: false }>;

export interface CreateImportSourceInput {
  businessId: string;
  createdByUserId: string;
  label: string;
}

/** "Sync started" — the KnowledgeSource row created the moment an upload/paste is accepted, before parsing runs. */
export async function createImportSource(input: CreateImportSourceInput, db: PrismaClientOrTransaction = prisma) {
  return db.knowledgeSource.create({
    data: {
      businessId: input.businessId,
      sourceType: "WHATSAPP_IMPORT",
      label: input.label,
      status: "PENDING",
      createdByUserId: input.createdByUserId,
    },
  });
}

/**
 * Idempotency check for file-based imports (paste has no file, so no hash to
 * check) — a duplicate hash within the same business short-circuits to
 * "already imported" rather than silently reprocessing. Scoped by
 * businessId first, matching every other tenant-scoped lookup in this
 * codebase (server/services/lead-service.ts's assertLeadBelongsToBusiness).
 */
export async function findImportedConversationByFileHash(
  businessId: string,
  rawFileHash: string,
  db: PrismaClientOrTransaction = prisma,
) {
  return db.importedConversation.findFirst({
    where: { businessId, rawFileHash },
    include: { source: true },
  });
}

export interface PersistParsedConversationInput {
  businessId: string;
  sourceId: string;
  externalSource: ExternalConversationSource;
  /** The raw export's own chat identifier/filename — not our internal id. */
  sourceConversationId: string;
  dateOrder: ImportDateOrder;
  timezone: string;
  rawFileHash?: string;
  parsed: ResolvedParseResult;
}

/**
 * Writes the parsed conversation and flips the source to PROCESSING (parsed,
 * awaiting extraction — server/knowledge/extract.ts runs next and moves it
 * to COMPLETED/PARTIAL/FAILED). One transaction: a conversation is never
 * left half-written if message insertion fails partway through.
 */
export async function persistParsedConversation(input: PersistParsedConversationInput, db: PrismaClient = prisma) {
  const conversation = await db.importedConversation.create({
    data: {
      businessId: input.businessId,
      sourceId: input.sourceId,
      externalSource: input.externalSource,
      sourceConversationId: input.sourceConversationId,
      participantLabels: input.parsed.participantLabels,
      dateOrder: input.dateOrder,
      timezone: input.timezone,
      resolvedBusinessSenderLabel: input.parsed.resolution.businessSenderLabel,
      resolutionMethod: input.parsed.resolution.method as ImportedConversationResolutionMethod,
      rawFileHash: input.rawFileHash,
      parseWarnings: input.parsed.warnings.length > 0 ? (input.parsed.warnings as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      messages: {
        create: input.parsed.messages.map((message) => ({
          senderLabel: message.senderLabel,
          resolvedRole: message.resolvedRole,
          occurredAt: message.occurredAt,
          content: message.content,
          rawLine: message.rawLine,
          sequenceIndex: message.sequenceIndex,
        })),
      },
    },
    include: { messages: { orderBy: { sequenceIndex: "asc" } } },
  });

  await db.knowledgeSource.update({ where: { id: input.sourceId }, data: { status: "PROCESSING" } });

  return conversation;
}

export async function markImportSourceFailed(sourceId: string, errorMessage: string, db: PrismaClientOrTransaction = prisma) {
  return db.knowledgeSource.update({ where: { id: sourceId }, data: { status: "FAILED", errorMessage } });
}

export async function getImportedConversationWithMessages(
  businessId: string,
  importedConversationId: string,
  db: PrismaClientOrTransaction = prisma,
) {
  return db.importedConversation.findFirst({
    where: { id: importedConversationId, businessId },
    include: { messages: { orderBy: { sequenceIndex: "asc" } } },
  });
}

export async function listImportSources(businessId: string, db: PrismaClientOrTransaction = prisma) {
  return db.knowledgeSource.findMany({
    where: { businessId, sourceType: "WHATSAPP_IMPORT" },
    orderBy: { createdAt: "desc" },
    include: { importedConversations: { select: { id: true, sourceConversationId: true, participantLabels: true } } },
  });
}
