// Converts every supported WhatsApp payload shape into the provider-neutral
// NormalizedWhatsAppMessage / NormalizedWhatsAppStatus. This is the one
// place that understands Meta's per-type field names — nothing downstream
// (the gateway, ingestion, Kori) ever branches on message.type again.

import type {
  NormalizedContactCard,
  NormalizedWhatsAppBusinessAppMessage,
  NormalizedWhatsAppMessage,
  NormalizedWhatsAppMessageType,
  NormalizedWhatsAppStatus,
  WhatsAppRawAudioMessage,
  WhatsAppRawContact,
  WhatsAppRawContactsMessage,
  WhatsAppRawDocumentMessage,
  WhatsAppRawImageMessage,
  WhatsAppRawLocationMessage,
  WhatsAppRawMessage,
  WhatsAppRawMessageEcho,
  WhatsAppRawStatus,
  WhatsAppRawStatusValue,
  WhatsAppRawStickerMessage,
  WhatsAppRawTextMessage,
  WhatsAppRawVideoMessage,
} from "./types";

function unixSecondsToDate(timestamp: string): Date {
  return new Date(Number(timestamp) * 1000);
}

const STATUS_MAP: Record<WhatsAppRawStatusValue, NormalizedWhatsAppStatus["status"]> = {
  sent: "SENT",
  delivered: "DELIVERED",
  read: "READ",
  failed: "FAILED",
};

export function normalizeStatusEvent(raw: WhatsAppRawStatus, phoneNumberId: string): NormalizedWhatsAppStatus {
  const firstError = raw.errors?.[0];
  return {
    externalId: raw.id,
    phoneNumberId,
    recipientPhoneNumber: raw.recipient_id,
    status: STATUS_MAP[raw.status] ?? "FAILED",
    occurredAt: unixSecondsToDate(raw.timestamp),
    errorCode: firstError ? String(firstError.code) : undefined,
    errorMessage: firstError?.title,
    raw,
  };
}

export function normalizeInboundMessage(
  raw: WhatsAppRawMessage,
  context: { phoneNumberId: string; contacts?: WhatsAppRawContact[] },
): NormalizedWhatsAppMessage {
  const contactName = context.contacts?.find((c) => c.wa_id === raw.from)?.profile.name;
  const occurredAt = unixSecondsToDate(raw.timestamp);
  const base = {
    externalId: raw.id,
    phoneNumberId: context.phoneNumberId,
    fromPhoneNumber: raw.from,
    contactName,
    occurredAt,
    quotedExternalId: raw.context?.id,
    raw,
  };

  // Explicit `as` casts per case rather than relying on switch-based
  // discriminated narrowing: WhatsAppRawUnknownMessage's `type: string`
  // (needed so genuinely-unrecognized future Meta message types don't blow
  // up the type system) makes `type` a non-literal discriminant, which
  // defeats TypeScript's automatic narrowing for every other case too.
  switch (raw.type) {
    case "text": {
      const message = raw as WhatsAppRawTextMessage;
      return { ...base, messageType: "TEXT", content: message.text.body };
    }

    case "image": {
      const message = raw as WhatsAppRawImageMessage;
      return {
        ...base,
        messageType: "IMAGE",
        content: message.image.caption ?? "[image]",
        media: {
          mediaId: message.image.id,
          mimeType: message.image.mime_type,
          caption: message.image.caption,
        },
      };
    }

    case "document": {
      const message = raw as WhatsAppRawDocumentMessage;
      return {
        ...base,
        messageType: "DOCUMENT",
        content: message.document.caption ?? message.document.filename ?? "[document]",
        media: {
          mediaId: message.document.id,
          mimeType: message.document.mime_type,
          filename: message.document.filename,
          caption: message.document.caption,
        },
      };
    }

    case "audio": {
      const message = raw as WhatsAppRawAudioMessage;
      return {
        ...base,
        messageType: "AUDIO",
        content: "[audio]",
        media: { mediaId: message.audio.id, mimeType: message.audio.mime_type },
      };
    }

    case "video": {
      const message = raw as WhatsAppRawVideoMessage;
      return {
        ...base,
        messageType: "VIDEO",
        content: message.video.caption ?? "[video]",
        media: {
          mediaId: message.video.id,
          mimeType: message.video.mime_type,
          caption: message.video.caption,
        },
      };
    }

    case "sticker": {
      const message = raw as WhatsAppRawStickerMessage;
      return {
        ...base,
        messageType: "STICKER",
        content: "[sticker]",
        media: { mediaId: message.sticker.id, mimeType: message.sticker.mime_type },
      };
    }

    case "contacts": {
      const message = raw as WhatsAppRawContactsMessage;
      const contacts: NormalizedContactCard[] = message.contacts.map((c) => ({
        formattedName: c.name.formatted_name,
        phone: c.phones?.[0]?.phone,
      }));
      return {
        ...base,
        messageType: "CONTACT",
        content: contacts.map((c) => c.formattedName).join(", ") || "[contact]",
        contacts,
      };
    }

    case "location": {
      const message = raw as WhatsAppRawLocationMessage;
      return {
        ...base,
        messageType: "LOCATION",
        content: message.location.name ?? message.location.address ?? "[location]",
        location: {
          latitude: message.location.latitude,
          longitude: message.location.longitude,
          name: message.location.name,
          address: message.location.address,
        },
      };
    }

    default: {
      const unknownType: NormalizedWhatsAppMessageType = "UNKNOWN";
      return { ...base, messageType: unknownType, content: `[unsupported message type: ${raw.type}]` };
    }
  }
}

/**
 * Meta's documented smb_message_echoes shape doesn't pin down the exact
 * recipient field name in any primary source we could confirm — this reads
 * the most likely candidates defensively rather than assuming one. Only
 * matters for "NEW" echoes (the ones that resolve a Lead/Conversation);
 * EDIT/REVOKE never need it in v1 (see normalizeBusinessAppEchoMessage).
 */
function extractRecipientPhoneNumber(raw: WhatsAppRawMessageEcho): string | undefined {
  const candidate = raw.to ?? raw.recipient_id ?? raw.wa_id;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : undefined;
}

function extractEchoContent(raw: WhatsAppRawMessageEcho): { messageType: NormalizedWhatsAppMessageType; content: string } {
  switch (raw.type) {
    case "text": {
      const text = raw.text as { body?: string } | undefined;
      return { messageType: "TEXT", content: text?.body ?? "" };
    }
    case "image": {
      const image = raw.image as { caption?: string } | undefined;
      return { messageType: "IMAGE", content: image?.caption ?? "[image]" };
    }
    case "document": {
      const document = raw.document as { caption?: string; filename?: string } | undefined;
      return { messageType: "DOCUMENT", content: document?.caption ?? document?.filename ?? "[document]" };
    }
    case "audio":
      return { messageType: "AUDIO", content: "[audio]" };
    case "video": {
      const video = raw.video as { caption?: string } | undefined;
      return { messageType: "VIDEO", content: video?.caption ?? "[video]" };
    }
    case "sticker":
      return { messageType: "STICKER", content: "[sticker]" };
    default:
      return { messageType: "UNKNOWN", content: `[unsupported message type: ${raw.type}]` };
  }
}

/**
 * Normalizes a Coexistence smb_message_echoes item — a message the business
 * sent from the WhatsApp Business app or a linked device. EDIT/REVOKE are
 * recognized but deliberately left content-free: server/whatsapp/gateway.ts's
 * handleBusinessAppEchoEvent short-circuits them to a no-op in v1 (see its
 * doc comment), so their exact recipient/content shape is never read.
 */
export function normalizeBusinessAppEchoMessage(
  raw: WhatsAppRawMessageEcho,
  context: { phoneNumberId: string },
): NormalizedWhatsAppBusinessAppMessage {
  const occurredAt = unixSecondsToDate(raw.timestamp);
  const recipient = extractRecipientPhoneNumber(raw);
  const base = { externalId: raw.id, phoneNumberId: context.phoneNumberId, occurredAt, raw };

  if (raw.type === "revoke") {
    return { ...base, toPhoneNumber: recipient ?? "", subtype: "REVOKE", messageType: "UNKNOWN", content: "[message revoked]" };
  }
  if (raw.type === "edit") {
    return { ...base, toPhoneNumber: recipient ?? "", subtype: "EDIT", messageType: "UNKNOWN", content: "[message edited]" };
  }

  if (!recipient) {
    throw new Error(`smb_message_echoes item "${raw.id}" is missing a recipient phone number.`);
  }
  const { messageType, content } = extractEchoContent(raw);
  return { ...base, toPhoneNumber: recipient, subtype: "NEW", messageType, content };
}
