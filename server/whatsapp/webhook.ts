import "server-only";

import { z } from "zod";
import { InvalidWebhookPayloadError } from "./errors";
import type { WhatsAppGateway } from "./gateway";
import { normalizeBusinessAppEchoMessage, normalizeInboundMessage, normalizeStatusEvent } from "./message-normalizer";
import type { WhatsAppRawContact, WhatsAppRawMessage, WhatsAppRawMessageEcho, WhatsAppRawStatus } from "./types";
import { verifyWebhookSignature, verifyWebhookSubscription } from "./verification";

// The webhook entry point's whole job: verify, receive, validate, normalize,
// call the gateway. Nothing else — no CRM writes, no orchestration calls, no
// Meta-specific business logic beyond parsing/routing the payload. Framework-
// agnostic on purpose (raw string body + header in, plain object out) so it's
// testable without a Next.js request/response; app/api/whatsapp/webhook/route.ts
// is the thin adapter that actually wires it to HTTP.

const rawContactSchema = z.object({
  wa_id: z.string().min(1),
  profile: z.object({ name: z.string().optional() }),
});

// Message/status item shapes are intentionally loose beyond the fields the
// gateway/normalizer actually need — deeper per-type interpretation (and
// graceful handling of message types Meta hasn't invented yet) is
// message-normalizer.ts's job, not this schema's.
const rawMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    timestamp: z.string().min(1),
    type: z.string().min(1),
  })
  .passthrough();

const rawStatusSchema = z
  .object({
    id: z.string().min(1),
    status: z.enum(["sent", "delivered", "read", "failed"]),
    timestamp: z.string().min(1),
    recipient_id: z.string().min(1),
  })
  .passthrough();

// Coexistence-only field: messages the business sent from the WhatsApp
// Business app or a linked device, mirrored to Cloud API. Kept as loose as
// rawMessageSchema on purpose — see message-normalizer.ts's
// normalizeBusinessAppEchoMessage doc comment for why the recipient field
// is read defensively downstream instead of pinned here.
const rawMessageEchoSchema = z
  .object({
    id: z.string().min(1),
    timestamp: z.string().min(1),
    type: z.string().min(1),
  })
  .passthrough();

const webhookValueSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string().min(1),
  }),
  contacts: z.array(rawContactSchema).optional(),
  messages: z.array(rawMessageSchema).optional(),
  statuses: z.array(rawStatusSchema).optional(),
  smb_message_echoes: z.array(rawMessageEchoSchema).optional(),
});

const webhookChangeSchema = z.object({
  field: z.string(),
  value: webhookValueSchema,
});

const webhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(webhookChangeSchema),
});

export const whatsAppWebhookPayloadSchema = z.object({
  object: z.string(),
  entry: z.array(webhookEntrySchema),
});

/** GET handshake — delegates entirely to verification.ts. */
export function handleVerificationRequest(
  query: { mode: string | null; verifyToken: string | null; challenge: string | null },
  expectedVerifyToken: string,
): string {
  return verifyWebhookSubscription(query, expectedVerifyToken);
}

export interface WebhookProcessingSummary {
  messagesProcessed: number;
  statusesProcessed: number;
  duplicatesSkipped: number;
  /** Coexistence smb_message_echoes items successfully persisted as OUTBOUND entries. */
  echoesProcessed: number;
  /** Coexistence smb_message_echoes edit/revoke items — recognized but not persisted in v1. */
  echoesIgnored: number;
  /** One entry per item that failed — a bad item in a batch never aborts the rest. */
  errors: unknown[];
}

export interface HandleWebhookEventDependencies {
  appSecret: string;
  gateway: WhatsAppGateway;
}

/**
 * The POST entry point. Payloads are never trusted blindly: the signature
 * is checked before anything else, and the body is schema-validated before
 * any field is read. Each message/status in the batch is processed
 * independently — one malformed or unresolvable item doesn't stop the rest.
 */
export async function handleWebhookEvent(
  rawBody: string,
  signatureHeader: string | null,
  dependencies: HandleWebhookEventDependencies,
): Promise<WebhookProcessingSummary> {
  verifyWebhookSignature(rawBody, signatureHeader, dependencies.appSecret);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    throw new InvalidWebhookPayloadError("Webhook body is not valid JSON.");
  }

  const parsed = whatsAppWebhookPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new InvalidWebhookPayloadError("Webhook payload does not match the expected WhatsApp shape.", parsed.error.issues);
  }

  const summary: WebhookProcessingSummary = {
    messagesProcessed: 0,
    statusesProcessed: 0,
    duplicatesSkipped: 0,
    echoesProcessed: 0,
    echoesIgnored: 0,
    errors: [],
  };

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const { value } = change;
      const phoneNumberId = value.metadata.phone_number_id;

      for (const rawMessage of value.messages ?? []) {
        try {
          const normalized = normalizeInboundMessage(rawMessage as WhatsAppRawMessage, {
            phoneNumberId,
            contacts: value.contacts as WhatsAppRawContact[] | undefined,
          });
          const result = await dependencies.gateway.handleInboundMessage(normalized);
          if (result.duplicate) {
            summary.duplicatesSkipped += 1;
          } else {
            summary.messagesProcessed += 1;
          }
        } catch (error) {
          summary.errors.push(error);
        }
      }

      for (const rawStatus of value.statuses ?? []) {
        try {
          const normalized = normalizeStatusEvent(rawStatus as WhatsAppRawStatus, phoneNumberId);
          await dependencies.gateway.handleStatusEvent(normalized);
          summary.statusesProcessed += 1;
        } catch (error) {
          summary.errors.push(error);
        }
      }

      // Coexistence only — absent entirely for numbers not onboarded via
      // Embedded Signup's business-app flow, so this loop is a no-op for
      // every payload shape that existed before this field was added.
      for (const rawEcho of value.smb_message_echoes ?? []) {
        try {
          const normalized = normalizeBusinessAppEchoMessage(rawEcho as WhatsAppRawMessageEcho, { phoneNumberId });
          const result = await dependencies.gateway.handleBusinessAppEchoEvent(normalized);
          if (result.duplicate) {
            summary.duplicatesSkipped += 1;
          } else if (result.ignored) {
            summary.echoesIgnored += 1;
          } else {
            summary.echoesProcessed += 1;
          }
        } catch (error) {
          summary.errors.push(error);
        }
      }
    }
  }

  return summary;
}
