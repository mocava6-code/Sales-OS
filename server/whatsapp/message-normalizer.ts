// Converts every supported WhatsApp payload shape into the provider-neutral
// NormalizedWhatsAppMessage / NormalizedWhatsAppStatus. This is the one
// place that understands Meta's per-type field names — nothing downstream
// (the gateway, ingestion, Kori) ever branches on message.type again.

import type {
  NormalizedContactCard,
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
