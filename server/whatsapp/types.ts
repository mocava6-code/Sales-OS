// WhatsApp Cloud API types — the only file besides message-normalizer.ts
// that should ever need to change if Meta's payload shape changes. Two
// families live here: the raw wire shapes (WhatsAppWebhookPayload and
// friends, named to match Meta's own field names 1:1) and the
// provider-neutral normalized shapes the rest of the app actually consumes
// (NormalizedWhatsAppMessage / NormalizedWhatsAppStatus) — nothing outside
// server/whatsapp/** should ever import the raw shapes.

// --- Raw webhook payload (Meta's wire format) -------------------------------

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WhatsAppWebhookEntry[];
}

export interface WhatsAppWebhookEntry {
  id: string; // WABA id
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookChange {
  field: string; // "messages" for both inbound messages and status updates
  value: WhatsAppWebhookValue;
}

export interface WhatsAppWebhookValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WhatsAppRawContact[];
  messages?: WhatsAppRawMessage[];
  statuses?: WhatsAppRawStatus[];
}

export interface WhatsAppRawContact {
  wa_id: string;
  profile: { name?: string };
}

export interface WhatsAppRawContext {
  from?: string;
  id: string; // wamid of the message being replied to/quoted
}

interface WhatsAppRawMessageBase {
  id: string; // wamid — the idempotency key
  from: string;
  timestamp: string; // unix seconds, as a string
  context?: WhatsAppRawContext;
}

export interface WhatsAppRawTextMessage extends WhatsAppRawMessageBase {
  type: "text";
  text: { body: string };
}

export interface WhatsAppRawMediaObject {
  id: string;
  mime_type: string;
  sha256?: string;
  filename?: string;
  caption?: string;
}

export interface WhatsAppRawImageMessage extends WhatsAppRawMessageBase {
  type: "image";
  image: WhatsAppRawMediaObject;
}

export interface WhatsAppRawDocumentMessage extends WhatsAppRawMessageBase {
  type: "document";
  document: WhatsAppRawMediaObject;
}

export interface WhatsAppRawAudioMessage extends WhatsAppRawMessageBase {
  type: "audio";
  audio: WhatsAppRawMediaObject;
}

export interface WhatsAppRawVideoMessage extends WhatsAppRawMessageBase {
  type: "video";
  video: WhatsAppRawMediaObject;
}

export interface WhatsAppRawStickerMessage extends WhatsAppRawMessageBase {
  type: "sticker";
  sticker: WhatsAppRawMediaObject;
}

export interface WhatsAppRawContactsMessage extends WhatsAppRawMessageBase {
  type: "contacts";
  contacts: Array<{
    name: { formatted_name: string };
    phones?: Array<{ phone?: string; wa_id?: string }>;
  }>;
}

export interface WhatsAppRawLocationMessage extends WhatsAppRawMessageBase {
  type: "location";
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface WhatsAppRawUnknownMessage extends WhatsAppRawMessageBase {
  type: string;
  [key: string]: unknown;
}

export type WhatsAppRawMessage =
  | WhatsAppRawTextMessage
  | WhatsAppRawImageMessage
  | WhatsAppRawDocumentMessage
  | WhatsAppRawAudioMessage
  | WhatsAppRawVideoMessage
  | WhatsAppRawStickerMessage
  | WhatsAppRawContactsMessage
  | WhatsAppRawLocationMessage
  | WhatsAppRawUnknownMessage;

export type WhatsAppRawStatusValue = "sent" | "delivered" | "read" | "failed";

export interface WhatsAppRawStatus {
  id: string; // wamid of the outbound message this status is about
  status: WhatsAppRawStatusValue;
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string; message?: string }>;
}

// --- Normalized (provider-neutral) shapes -----------------------------------

export type NormalizedWhatsAppMessageType =
  | "TEXT"
  | "IMAGE"
  | "DOCUMENT"
  | "AUDIO"
  | "VIDEO"
  | "STICKER"
  | "CONTACT"
  | "LOCATION"
  | "UNKNOWN";

export interface NormalizedMediaReference {
  mediaId: string;
  mimeType: string;
  filename?: string;
  sizeBytes?: number;
  caption?: string;
}

export interface NormalizedLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface NormalizedContactCard {
  formattedName: string;
  phone?: string;
}

/**
 * The provider-neutral shape everything outside server/whatsapp/** consumes.
 * `content` is always populated — the message text, or a human-readable
 * fallback for non-text types — so it maps directly onto
 * ConversationEntry.content regardless of messageType.
 */
export interface NormalizedWhatsAppMessage {
  externalId: string;
  phoneNumberId: string;
  fromPhoneNumber: string;
  contactName?: string;
  messageType: NormalizedWhatsAppMessageType;
  content: string;
  occurredAt: Date;
  media?: NormalizedMediaReference;
  location?: NormalizedLocation;
  contacts?: NormalizedContactCard[];
  /** wamid of the message this one replies to/quotes, if any. */
  quotedExternalId?: string;
  /** The raw Meta message node, preserved verbatim for debugging. */
  raw: unknown;
}

export type NormalizedWhatsAppStatusValue = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface NormalizedWhatsAppStatus {
  externalId: string;
  phoneNumberId: string;
  recipientPhoneNumber: string;
  status: NormalizedWhatsAppStatusValue;
  occurredAt: Date;
  errorCode?: string;
  errorMessage?: string;
  raw: unknown;
}

/** One webhook POST can carry a mix of inbound messages and status updates across multiple numbers/businesses. */
export interface NormalizedWebhookBatch {
  messages: NormalizedWhatsAppMessage[];
  statuses: NormalizedWhatsAppStatus[];
}
