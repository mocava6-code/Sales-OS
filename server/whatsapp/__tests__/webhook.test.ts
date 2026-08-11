import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InvalidWebhookPayloadError, InvalidWebhookSignatureError, WebhookVerificationFailedError } from "../errors";
import type { WhatsAppGateway } from "../gateway";
import { handleVerificationRequest, handleWebhookEvent } from "../webhook";

const APP_SECRET = "test-app-secret";

function sign(body: string): string {
  return `sha256=${createHmac("sha256", APP_SECRET).update(body, "utf8").digest("hex")}`;
}

function fakeGateway(overrides: Partial<WhatsAppGateway> = {}): WhatsAppGateway {
  return {
    handleInboundMessage: vi.fn(async () => ({ duplicate: false, analysisTriggered: true, observationsRecorded: true, profileProjected: true, contactNameUpdated: false })),
    handleStatusEvent: vi.fn(async () => ({ applied: true })),
    handleBusinessAppEchoEvent: vi.fn(async () => ({ duplicate: false, observationsRecorded: true })),
    enqueueOutboundMessage: vi.fn(async () => ({ id: "pending-1" })),
    ...overrides,
  };
}

function textMessagePayload(overrides: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba-1",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "16505551111", phone_number_id: "123456" },
              contacts: [{ wa_id: "16315551234", profile: { name: "Kerry Fisher" } }],
              messages: [
                { id: "wamid.MSG1", from: "16315551234", timestamp: "1700000000", type: "text", text: { body: "Hola" } },
              ],
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

describe("handleVerificationRequest — 1. webhook verification", () => {
  it("returns the challenge for a valid handshake", () => {
    const challenge = handleVerificationRequest(
      { mode: "subscribe", verifyToken: "secret", challenge: "abc123" },
      "secret",
    );
    expect(challenge).toBe("abc123");
  });

  it("throws WebhookVerificationFailedError for a wrong token", () => {
    expect(() => handleVerificationRequest({ mode: "subscribe", verifyToken: "wrong", challenge: "abc" }, "secret")).toThrow(
      WebhookVerificationFailedError,
    );
  });
});

describe("handleWebhookEvent — 2. parsing, 3. normalization dispatch, never trusting payloads blindly", () => {
  it("rejects an unsigned request before parsing anything", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(textMessagePayload());

    await expect(handleWebhookEvent(body, null, { appSecret: APP_SECRET, gateway })).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
    expect(gateway.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("rejects a tampered body even with a signature present", async () => {
    const gateway = fakeGateway();
    const original = JSON.stringify(textMessagePayload());
    const tampered = JSON.stringify(textMessagePayload({ messages: [] }));

    await expect(
      handleWebhookEvent(tampered, sign(original), { appSecret: APP_SECRET, gateway }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it("rejects invalid JSON", async () => {
    const gateway = fakeGateway();
    const body = "{not valid json";

    await expect(handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway })).rejects.toBeInstanceOf(
      InvalidWebhookPayloadError,
    );
  });

  it("rejects a well-formed JSON body that doesn't match the WhatsApp shape", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify({ unrelated: true });

    await expect(handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway })).rejects.toBeInstanceOf(
      InvalidWebhookPayloadError,
    );
  });

  it("does not reject a webhook batch containing a change for a field this webhook doesn't process", async () => {
    // A WABA subscribed to more than the "messages" field (e.g. template
    // status updates) gets those delivered to this same endpoint. Their
    // `value` looks nothing like a messages value — that must not fail the
    // whole request.
    const gateway = fakeGateway();
    const templateStatusPayload = {
      object: "whatsapp_business_account",
      entry: [
        {
          id: "waba-1",
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: 954500552305159,
                message_template_name: "welcome",
                message_template_language: "en_US",
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(templateStatusPayload);

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.errors).toHaveLength(0);
    expect(summary.messagesProcessed).toBe(0);
    expect(gateway.handleInboundMessage).not.toHaveBeenCalled();
  });

  it("processes a messages change alongside an unrelated change in the same batch", async () => {
    const gateway = fakeGateway();
    const payload = textMessagePayload();
    payload.entry[0].changes.push({
      field: "phone_number_name_update",
      value: { decision: "APPROVED", requested_verified_name: "Acme Inc" },
    } as unknown as (typeof payload.entry)[0]["changes"][0]);
    const body = JSON.stringify(payload);

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.messagesProcessed).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });

  it("normalizes and dispatches a valid text message to the gateway", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(textMessagePayload());

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.messagesProcessed).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(gateway.handleInboundMessage).toHaveBeenCalledTimes(1);
    const [normalized] = (gateway.handleInboundMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(normalized.externalId).toBe("wamid.MSG1");
    expect(normalized.messageType).toBe("TEXT");
    expect(normalized.contactName).toBe("Kerry Fisher");
  });

  it("counts a duplicate result from the gateway separately from processed messages", async () => {
    const gateway = fakeGateway({ handleInboundMessage: vi.fn(async () => ({ duplicate: true, analysisTriggered: false, observationsRecorded: false, profileProjected: false, contactNameUpdated: false })) });
    const body = JSON.stringify(textMessagePayload());

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.messagesProcessed).toBe(0);
    expect(summary.duplicatesSkipped).toBe(1);
  });

  it("normalizes and dispatches a status update to the gateway", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(
      textMessagePayload({
        messages: undefined,
        contacts: undefined,
        statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1700000000", recipient_id: "16315551234" }],
      }),
    );

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.statusesProcessed).toBe(1);
    expect(gateway.handleStatusEvent).toHaveBeenCalledTimes(1);
    const [normalized] = (gateway.handleStatusEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(normalized.status).toBe("DELIVERED");
  });

  it("processes a valid message even when a sibling status in the same value has an unrecognized status value", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(
      textMessagePayload({
        statuses: [{ id: "wamid.OUT1", status: "warning", timestamp: "1700000000", recipient_id: "16315551234" }],
      }),
    );

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.messagesProcessed).toBe(1);
    expect(gateway.handleInboundMessage).toHaveBeenCalledTimes(1);
    expect(summary.errors).toHaveLength(1);
  });

  it("continues processing the rest of the batch when one item's gateway call throws", async () => {
    let call = 0;
    const gateway = fakeGateway({
      handleInboundMessage: vi.fn(async () => {
        call += 1;
        if (call === 1) throw new Error("boom");
        return { duplicate: false, analysisTriggered: true, observationsRecorded: true, profileProjected: true, contactNameUpdated: false };
      }),
    });
    const body = JSON.stringify(
      textMessagePayload({
        messages: [
          { id: "wamid.A", from: "16315551234", timestamp: "1700000000", type: "text", text: { body: "1" } },
          { id: "wamid.B", from: "16315551234", timestamp: "1700000001", type: "text", text: { body: "2" } },
        ],
      }),
    );

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.errors).toHaveLength(1);
    expect(summary.messagesProcessed).toBe(1);
    expect(gateway.handleInboundMessage).toHaveBeenCalledTimes(2);
  });

  it("regression: a payload with no smb_message_echoes key processes identically to before this field existed", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(textMessagePayload());

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary).toEqual({
      messagesProcessed: 1,
      statusesProcessed: 0,
      duplicatesSkipped: 0,
      echoesProcessed: 0,
      echoesIgnored: 0,
      errors: [],
    });
    expect(gateway.handleBusinessAppEchoEvent).not.toHaveBeenCalled();
  });
});

describe("handleWebhookEvent — Coexistence smb_message_echoes", () => {
  function echoPayload(overrides: Record<string, unknown> = {}) {
    return textMessagePayload({
      messages: undefined,
      contacts: undefined,
      smb_message_echoes: [
        { id: "wamid.ECHO1", to: "16315551234", timestamp: "1700000000", type: "text", text: { body: "On my way" } },
      ],
      ...overrides,
    });
  }

  it("normalizes and dispatches a business-app echo to the gateway", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(echoPayload());

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.echoesProcessed).toBe(1);
    expect(summary.errors).toHaveLength(0);
    expect(gateway.handleBusinessAppEchoEvent).toHaveBeenCalledTimes(1);
    const [normalized] = (gateway.handleBusinessAppEchoEvent as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(normalized.externalId).toBe("wamid.ECHO1");
    expect(normalized.toPhoneNumber).toBe("16315551234");
    expect(normalized.subtype).toBe("NEW");
  });

  it("counts a duplicate echo result the same way a duplicate message is counted", async () => {
    const gateway = fakeGateway({ handleBusinessAppEchoEvent: vi.fn(async () => ({ duplicate: true, observationsRecorded: false })) });
    const body = JSON.stringify(echoPayload());

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.echoesProcessed).toBe(0);
    expect(summary.duplicatesSkipped).toBe(1);
  });

  it("counts an ignored (edit/revoke) echo result separately", async () => {
    const gateway = fakeGateway({ handleBusinessAppEchoEvent: vi.fn(async () => ({ duplicate: false, ignored: true, observationsRecorded: false })) });
    const body = JSON.stringify(echoPayload({ smb_message_echoes: [{ id: "wamid.ECHO1", timestamp: "1700000000", type: "revoke" }] }));

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.echoesIgnored).toBe(1);
    expect(summary.echoesProcessed).toBe(0);
    expect(summary.duplicatesSkipped).toBe(0);
  });

  it("processes messages, statuses, and echoes independently within one batch", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(
      textMessagePayload({
        messages: [{ id: "wamid.IN1", from: "16315551234", timestamp: "1700000000", type: "text", text: { body: "Hola" } }],
        statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1700000000", recipient_id: "16315551234" }],
        smb_message_echoes: [{ id: "wamid.ECHO1", to: "16315551234", timestamp: "1700000000", type: "text", text: { body: "On my way" } }],
      }),
    );

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.messagesProcessed).toBe(1);
    expect(summary.statusesProcessed).toBe(1);
    expect(summary.echoesProcessed).toBe(1);
    expect(summary.errors).toHaveLength(0);
  });

  it("continues processing the rest of the batch when one echo item fails to normalize", async () => {
    const gateway = fakeGateway();
    const body = JSON.stringify(
      echoPayload({
        smb_message_echoes: [
          { id: "wamid.ECHO1", timestamp: "1700000000", type: "text", text: { body: "missing recipient" } },
          { id: "wamid.ECHO2", to: "16315551234", timestamp: "1700000001", type: "text", text: { body: "has recipient" } },
        ],
      }),
    );

    const summary = await handleWebhookEvent(body, sign(body), { appSecret: APP_SECRET, gateway });

    expect(summary.errors).toHaveLength(1);
    expect(summary.echoesProcessed).toBe(1);
  });
});
