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

// Only the fields every "messages"-field value has in common, regardless of
// which of contacts/messages/statuses/smb_message_echoes it happens to
// carry — phoneNumberId is the one thing every item in the loop below
// needs. The arrays themselves are deliberately NOT validated here: doing
// so would make one bad status or message (an unrecognized enum value, a
// field Meta added since this schema was written, ...) invalidate the
// whole value and silently drop every *other*, perfectly valid item riding
// alongside it in the same batch. Each array is instead read as unknown[]
// and its items are validated one at a time in the processing loop, so a
// bad item only ever costs itself.
const webhookValueMetaSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: z.object({
    display_phone_number: z.string(),
    phone_number_id: z.string().min(1),
  }),
});

// `value`'s shape depends on `field`. Only "messages" (inbound messages and
// status updates) uses webhookValueMetaSchema — a WABA subscribed to other
// fields (message_template_status_update, phone_number_name_update,
// account_update, security, ...) gets those delivered to this same
// endpoint with a completely different value shape. Validating `value`
// eagerly here would reject the whole request for a change type this
// webhook was never meant to read. It's parsed per-change instead, inside
// the processing loop below, once we know what `field` actually is.
const webhookChangeSchema = z.object({
  field: z.string(),
  value: z.unknown(),
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
      const metaParse = webhookValueMetaSchema.safeParse(change.value);
      if (!metaParse.success) {
        // Only "messages" changes are supposed to have this shape. Any other
        // field (template status updates, phone number updates, account
        // alerts, ...) legitimately looks nothing like it — that's not a
        // processing failure, just a change type this webhook doesn't read.
        if (change.field === "messages") {
          const error = new InvalidWebhookPayloadError(
            `Webhook change with field "messages" does not match the expected shape.`,
            metaParse.error.issues,
          );
          console.error("[whatsapp webhook] malformed messages change, skipping:", { field: change.field, error, stack: error.stack });
          summary.errors.push(error);
        }
        continue;
      }

      const phoneNumberId = metaParse.data.metadata.phone_number_id;
      // `change.value` only had messaging_product/metadata validated above —
      // the arrays below are read as unknown[] and each item is validated
      // (and processed) independently, so one bad item can never take its
      // valid siblings down with it.
      const rawValue = change.value as Record<string, unknown>;

      const contacts: WhatsAppRawContact[] = [];
      for (const rawContact of asArray(rawValue.contacts)) {
        const contactParse = rawContactSchema.safeParse(rawContact);
        if (contactParse.success) contacts.push(contactParse.data);
      }

      for (const rawMessageUnknown of asArray(rawValue.messages)) {
        const messageParse = rawMessageSchema.safeParse(rawMessageUnknown);
        if (!messageParse.success) {
          const error = new InvalidWebhookPayloadError("Webhook message item does not match the expected shape.", messageParse.error.issues);
          console.error("[whatsapp webhook] malformed message item, skipping item:", { item: rawMessageUnknown, error, stack: error.stack });
          summary.errors.push(error);
          continue;
        }
        try {
          const normalized = normalizeInboundMessage(messageParse.data as WhatsAppRawMessage, { phoneNumberId, contacts });
          const result = await dependencies.gateway.handleInboundMessage(normalized);
          if (result.duplicate) {
            summary.duplicatesSkipped += 1;
          } else {
            summary.messagesProcessed += 1;
          }
        } catch (error) {
          console.error("[whatsapp webhook] failed to process inbound message, skipping item:", {
            item: messageParse.data,
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          summary.errors.push(error);
        }
      }

      for (const rawStatusUnknown of asArray(rawValue.statuses)) {
        const statusParse = rawStatusSchema.safeParse(rawStatusUnknown);
        if (!statusParse.success) {
          const error = new InvalidWebhookPayloadError("Webhook status item does not match the expected shape.", statusParse.error.issues);
          console.error("[whatsapp webhook] malformed status item, skipping item:", { item: rawStatusUnknown, error, stack: error.stack });
          summary.errors.push(error);
          continue;
        }
        try {
          const normalized = normalizeStatusEvent(statusParse.data as WhatsAppRawStatus, phoneNumberId);
          await dependencies.gateway.handleStatusEvent(normalized);
          summary.statusesProcessed += 1;
        } catch (error) {
          console.error("[whatsapp webhook] failed to process status update, skipping item:", {
            item: statusParse.data,
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          summary.errors.push(error);
        }
      }

      // Coexistence only — absent entirely for numbers not onboarded via
      // Embedded Signup's business-app flow, so this loop is a no-op for
      // every payload shape that existed before this field was added.
      for (const rawEchoUnknown of asArray(rawValue.smb_message_echoes)) {
        const echoParse = rawMessageEchoSchema.safeParse(rawEchoUnknown);
        if (!echoParse.success) {
          const error = new InvalidWebhookPayloadError("Webhook echo item does not match the expected shape.", echoParse.error.issues);
          console.error("[whatsapp webhook] malformed echo item, skipping item:", { item: rawEchoUnknown, error, stack: error.stack });
          summary.errors.push(error);
          continue;
        }
        try {
          const normalized = normalizeBusinessAppEchoMessage(echoParse.data as WhatsAppRawMessageEcho, { phoneNumberId });
          const result = await dependencies.gateway.handleBusinessAppEchoEvent(normalized);
          if (result.duplicate) {
            summary.duplicatesSkipped += 1;
          } else if (result.ignored) {
            summary.echoesIgnored += 1;
          } else {
            summary.echoesProcessed += 1;
          }
        } catch (error) {
          console.error("[whatsapp webhook] failed to process business-app echo, skipping item:", {
            item: echoParse.data,
            error,
            stack: error instanceof Error ? error.stack : undefined,
          });
          summary.errors.push(error);
        }
      }
    }
  }

  return summary;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
