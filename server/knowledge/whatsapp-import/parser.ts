// Orchestrates tokenizing + timestamp parsing + role resolution into the
// shape server/knowledge persists as ImportedConversation/ImportedMessage.
// Entirely deterministic — no LLM call anywhere in this module.

import { tokenizeWhatsAppExport } from "./tokenizer";
import { parseWhatsAppTimestamp, type ImportDateOrder } from "./timestamp";
import { resolveParticipantRoles, roleForSender, type ParticipantResolutionResult } from "./role-resolver";

export type { ImportDateOrder } from "./timestamp";

export interface ParseWarning {
  type: "UNPARSEABLE_TIMESTAMP";
  sequenceIndex: number;
  rawLine: string;
  detail: string;
}

export interface ParsedWhatsAppMessage {
  senderLabel: string;
  resolvedRole: "BUSINESS" | "CUSTOMER" | "UNKNOWN";
  /** Null — never fabricated — when the source line's timestamp didn't parse. */
  occurredAt: Date | null;
  content: string;
  rawLine: string;
  sequenceIndex: number;
}

export interface ParseWhatsAppExportInput {
  rawText: string;
  dateOrder: ImportDateOrder;
  timezone: string;
  /** The business's own User.name values, tried first for deterministic role resolution. */
  knownBusinessNames: string[];
  /** The OWNER's answer to a previously-required "which participant is Koriaki?" prompt. */
  manualBusinessSenderLabel?: string;
}

export type ParseWhatsAppExportResult =
  | {
      needsParticipantResolution: false;
      participantLabels: string[];
      messages: ParsedWhatsAppMessage[];
      resolution: Extract<ParticipantResolutionResult, { needsInput: false }>;
      warnings: ParseWarning[];
      systemMessageCount: number;
    }
  | {
      /** Parsing succeeded, but role resolution needs one answer before messages can be finalized with roles — see role-resolver.ts. Re-invoke with manualBusinessSenderLabel set. */
      needsParticipantResolution: true;
      participantLabels: string[];
      candidateLabels: [string, string];
    };

export function parseWhatsAppExport(input: ParseWhatsAppExportInput): ParseWhatsAppExportResult {
  const tokens = tokenizeWhatsAppExport(input.rawText);
  const messageTokens = tokens.filter(
    (t): t is typeof t & { kind: "MESSAGE"; senderLabel: string } => t.kind === "MESSAGE" && t.senderLabel !== null,
  );
  const systemMessageCount = tokens.length - messageTokens.length;
  const participantLabels = [...new Set(messageTokens.map((t) => t.senderLabel))];

  const resolution = resolveParticipantRoles(participantLabels, input.knownBusinessNames, input.manualBusinessSenderLabel);
  if (resolution.needsInput) {
    return { needsParticipantResolution: true, participantLabels, candidateLabels: resolution.candidateLabels };
  }

  const warnings: ParseWarning[] = [];
  const messages: ParsedWhatsAppMessage[] = messageTokens.map((token, index) => {
    const parsed = parseWhatsAppTimestamp(token.dateRaw, token.timeRaw, input.dateOrder, input.timezone);
    if (!parsed.date) {
      warnings.push({ type: "UNPARSEABLE_TIMESTAMP", sequenceIndex: index, rawLine: token.rawLine, detail: parsed.reason ?? "unknown" });
    }
    return {
      senderLabel: token.senderLabel,
      resolvedRole: roleForSender(token.senderLabel, resolution.businessSenderLabel, participantLabels.length),
      occurredAt: parsed.date,
      content: token.content.trim(),
      rawLine: token.rawLine,
      sequenceIndex: index,
    };
  });

  return { needsParticipantResolution: false, participantLabels, messages, resolution, warnings, systemMessageCount };
}
