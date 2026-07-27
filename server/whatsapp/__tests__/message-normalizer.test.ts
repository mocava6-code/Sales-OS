import { describe, expect, it } from "vitest";
import { normalizeBusinessAppEchoMessage, normalizeInboundMessage, normalizeStatusEvent } from "../message-normalizer";
import type {
  WhatsAppRawAudioMessage,
  WhatsAppRawContact,
  WhatsAppRawContactsMessage,
  WhatsAppRawDocumentMessage,
  WhatsAppRawImageMessage,
  WhatsAppRawLocationMessage,
  WhatsAppRawMessageEcho,
  WhatsAppRawStatus,
  WhatsAppRawStickerMessage,
  WhatsAppRawTextMessage,
  WhatsAppRawVideoMessage,
} from "../types";

const PHONE_NUMBER_ID = "1234567890";
const TIMESTAMP = "1700000000"; // fixed unix seconds for determinism

describe("normalizeInboundMessage — 2/3. parsing and normalization by type", () => {
  it("normalizes a text message", () => {
    const raw: WhatsAppRawTextMessage = {
      id: "wamid.TEXT1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "text",
      text: { body: "Hola, tengo una consulta" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result).toMatchObject({
      externalId: "wamid.TEXT1",
      phoneNumberId: PHONE_NUMBER_ID,
      fromPhoneNumber: "16315551234",
      messageType: "TEXT",
      content: "Hola, tengo una consulta",
    });
    expect(result.occurredAt).toEqual(new Date(1700000000 * 1000));
    expect(result.raw).toBe(raw);
  });

  it("normalizes an image message and its media metadata — 11. media metadata", () => {
    const raw: WhatsAppRawImageMessage = {
      id: "wamid.IMG1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "image",
      image: { id: "media-1", mime_type: "image/jpeg", sha256: "abc", caption: "Mira esto" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("IMAGE");
    expect(result.content).toBe("Mira esto");
    expect(result.media).toEqual({ mediaId: "media-1", mimeType: "image/jpeg", caption: "Mira esto" });
  });

  it("normalizes a document message with filename and no caption", () => {
    const raw: WhatsAppRawDocumentMessage = {
      id: "wamid.DOC1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "document",
      document: { id: "media-2", mime_type: "application/pdf", filename: "cotizacion.pdf" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("DOCUMENT");
    expect(result.content).toBe("cotizacion.pdf");
    expect(result.media).toEqual({
      mediaId: "media-2",
      mimeType: "application/pdf",
      filename: "cotizacion.pdf",
      caption: undefined,
    });
  });

  it("normalizes an audio message with no caption support", () => {
    const raw: WhatsAppRawAudioMessage = {
      id: "wamid.AUD1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "audio",
      audio: { id: "media-3", mime_type: "audio/ogg" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("AUDIO");
    expect(result.content).toBe("[audio]");
    expect(result.media).toEqual({ mediaId: "media-3", mimeType: "audio/ogg" });
  });

  it("normalizes a video message with a caption", () => {
    const raw: WhatsAppRawVideoMessage = {
      id: "wamid.VID1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "video",
      video: { id: "media-4", mime_type: "video/mp4", caption: "Kit instalado" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("VIDEO");
    expect(result.content).toBe("Kit instalado");
  });

  it("normalizes a sticker message", () => {
    const raw: WhatsAppRawStickerMessage = {
      id: "wamid.STK1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "sticker",
      sticker: { id: "media-5", mime_type: "image/webp" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("STICKER");
    expect(result.content).toBe("[sticker]");
  });

  it("normalizes a contacts message", () => {
    const raw: WhatsAppRawContactsMessage = {
      id: "wamid.CNT1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "contacts",
      contacts: [{ name: { formatted_name: "Juan Pérez" }, phones: [{ phone: "+52 1 55 1234 5678" }] }],
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("CONTACT");
    expect(result.content).toBe("Juan Pérez");
    expect(result.contacts).toEqual([{ formattedName: "Juan Pérez", phone: "+52 1 55 1234 5678" }]);
  });

  it("normalizes a location message", () => {
    const raw: WhatsAppRawLocationMessage = {
      id: "wamid.LOC1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "location",
      location: { latitude: 19.4326, longitude: -99.1332, name: "Taller Central" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("LOCATION");
    expect(result.content).toBe("Taller Central");
    expect(result.location).toEqual({
      latitude: 19.4326,
      longitude: -99.1332,
      name: "Taller Central",
      address: undefined,
    });
  });

  it("normalizes reply metadata (context) into quotedExternalId", () => {
    const raw: WhatsAppRawTextMessage = {
      id: "wamid.REPLY1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "text",
      text: { body: "Sí, ese mismo" },
      context: { id: "wamid.ORIGINAL1", from: "16315551234" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.quotedExternalId).toBe("wamid.ORIGINAL1");
  });

  it("falls back to UNKNOWN for an unsupported/future message type without throwing", () => {
    const raw = {
      id: "wamid.UNSUPPORTED1",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "interactive",
    } as unknown as WhatsAppRawTextMessage;

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("UNKNOWN");
    expect(result.content).toContain("interactive");
  });

  it("resolves the contact's profile name from the webhook's contacts array", () => {
    const raw: WhatsAppRawTextMessage = {
      id: "wamid.TEXT2",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "text",
      text: { body: "Hola" },
    };
    const contacts: WhatsAppRawContact[] = [{ wa_id: "16315551234", profile: { name: "Kerry Fisher" } }];

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID, contacts });

    expect(result.contactName).toBe("Kerry Fisher");
  });

  it("preserves the raw payload verbatim for debugging", () => {
    const raw: WhatsAppRawTextMessage = {
      id: "wamid.TEXT3",
      from: "16315551234",
      timestamp: TIMESTAMP,
      type: "text",
      text: { body: "Hola" },
    };

    const result = normalizeInboundMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.raw).toBe(raw);
  });
});

describe("normalizeStatusEvent", () => {
  it("normalizes a delivered status", () => {
    const raw: WhatsAppRawStatus = {
      id: "wamid.OUT1",
      status: "delivered",
      timestamp: TIMESTAMP,
      recipient_id: "16315551234",
    };

    const result = normalizeStatusEvent(raw, PHONE_NUMBER_ID);

    expect(result).toMatchObject({
      externalId: "wamid.OUT1",
      phoneNumberId: PHONE_NUMBER_ID,
      recipientPhoneNumber: "16315551234",
      status: "DELIVERED",
    });
    expect(result.errorCode).toBeUndefined();
  });

  it("normalizes a failed status with error details", () => {
    const raw: WhatsAppRawStatus = {
      id: "wamid.OUT2",
      status: "failed",
      timestamp: TIMESTAMP,
      recipient_id: "16315551234",
      errors: [{ code: 131047, title: "Re-engagement message" }],
    };

    const result = normalizeStatusEvent(raw, PHONE_NUMBER_ID);

    expect(result.status).toBe("FAILED");
    expect(result.errorCode).toBe("131047");
    expect(result.errorMessage).toBe("Re-engagement message");
  });
});

describe("normalizeBusinessAppEchoMessage — Coexistence smb_message_echoes", () => {
  it("normalizes a new text echo sent from the WhatsApp Business app", () => {
    const raw: WhatsAppRawMessageEcho = {
      id: "wamid.ECHO1",
      timestamp: TIMESTAMP,
      type: "text",
      to: "16315551234",
      text: { body: "En camino" },
    };

    const result = normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result).toMatchObject({
      externalId: "wamid.ECHO1",
      phoneNumberId: PHONE_NUMBER_ID,
      toPhoneNumber: "16315551234",
      subtype: "NEW",
      messageType: "TEXT",
      content: "En camino",
    });
    expect(result.occurredAt).toEqual(new Date(1700000000 * 1000));
    expect(result.raw).toBe(raw);
  });

  it("normalizes an image echo with a caption", () => {
    const raw: WhatsAppRawMessageEcho = {
      id: "wamid.ECHO2",
      timestamp: TIMESTAMP,
      type: "image",
      to: "16315551234",
      image: { id: "media-1", mime_type: "image/jpeg", caption: "Listo" },
    };

    const result = normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.messageType).toBe("IMAGE");
    expect(result.content).toBe("Listo");
  });

  it("falls back to a recipient_id field if to is absent", () => {
    const raw: WhatsAppRawMessageEcho = {
      id: "wamid.ECHO3",
      timestamp: TIMESTAMP,
      type: "text",
      recipient_id: "16315551234",
      text: { body: "Hola" },
    };

    const result = normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.toPhoneNumber).toBe("16315551234");
  });

  it("throws for a NEW echo with no resolvable recipient — the field name is unconfirmed against Meta's primary schema", () => {
    const raw: WhatsAppRawMessageEcho = { id: "wamid.ECHO4", timestamp: TIMESTAMP, type: "text", text: { body: "Hola" } };

    expect(() => normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID })).toThrow();
  });

  it("normalizes a revoke echo without requiring a recipient", () => {
    const raw: WhatsAppRawMessageEcho = { id: "wamid.ECHO5", timestamp: TIMESTAMP, type: "revoke" };

    const result = normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.subtype).toBe("REVOKE");
    expect(result.externalId).toBe("wamid.ECHO5");
  });

  it("normalizes an edit echo without requiring a recipient", () => {
    const raw: WhatsAppRawMessageEcho = { id: "wamid.ECHO6", timestamp: TIMESTAMP, type: "edit" };

    const result = normalizeBusinessAppEchoMessage(raw, { phoneNumberId: PHONE_NUMBER_ID });

    expect(result.subtype).toBe("EDIT");
  });
});
