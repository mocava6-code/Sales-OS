// Gated: proves sendReadyMessage's READY -> SENT transition against real
// Postgres (sales_os_test), using a fake WhatsAppSenderClient — never the
// real Meta Graph API.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidPendingMessageStatusTransitionError, PendingMessageNotFoundError, WhatsAppSendFailedError } from "../errors";
import { enqueuePendingMessage, markMessageReady } from "../queue";
import { sendReadyMessage, type WhatsAppSenderClient } from "../sender";
import {
  cleanupWhatsAppTestFixture,
  createWhatsAppTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type WhatsAppTestFixture,
} from "./test-db";

function fakeSenderClient(overrides: Partial<WhatsAppSenderClient> = {}): WhatsAppSenderClient {
  return {
    sendTextMessage: async () => ({ externalId: "wamid.FAKE-SENT-1" }),
    ...overrides,
  };
}

describe.skipIf(!shouldRunDbTests)("sendReadyMessage — 9. sending READY messages (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: WhatsAppTestFixture;

  beforeEach(async () => {
    fixture = await createWhatsAppTestFixture(db!, "sender");
  });

  afterEach(async () => {
    await cleanupWhatsAppTestFixture(db!, fixture);
  });

  it("moves a READY message to SENT using the injected client, recording the returned externalId", async () => {
    const message = await enqueuePendingMessage(
      {
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        whatsappPhoneNumberId: fixture.whatsappPhoneNumberId,
        toPhoneNumber: "+10000000002",
        body: "Hola, aquí tienes la cotización.",
      },
      db,
    );
    await markMessageReady(message.id, db);

    const result = await sendReadyMessage(message.id, { client: fakeSenderClient(), db });

    expect(result.status).toBe("SENT");
    expect(result.externalId).toBe("wamid.FAKE-SENT-1");

    const events = await db!.whatsAppMessageStatusEvent.findMany({ where: { pendingMessageId: message.id } });
    expect(events.map((e) => e.status)).toEqual(["SENT"]);
  });

  it("passes the registered phoneNumberId and message content to the client", async () => {
    const message = await enqueuePendingMessage(
      {
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        whatsappPhoneNumberId: fixture.whatsappPhoneNumberId,
        toPhoneNumber: "+10000000002",
        body: "Hola",
      },
      db,
    );
    await markMessageReady(message.id, db);

    let capturedInput: unknown;
    const client = fakeSenderClient({
      sendTextMessage: async (input) => {
        capturedInput = input;
        return { externalId: "wamid.CAPTURED" };
      },
    });

    await sendReadyMessage(message.id, { client, db });

    expect(capturedInput).toEqual({ phoneNumberId: fixture.phoneNumberId, to: "+10000000002", body: "Hola" });
  });

  it("marks the message FAILED and re-throws when the client rejects", async () => {
    const message = await enqueuePendingMessage(
      {
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        whatsappPhoneNumberId: fixture.whatsappPhoneNumberId,
        toPhoneNumber: "+10000000002",
        body: "Hola",
      },
      db,
    );
    await markMessageReady(message.id, db);

    const failingClient = fakeSenderClient({
      sendTextMessage: async () => {
        throw new WhatsAppSendFailedError("Graph API returned 400.");
      },
    });

    await expect(sendReadyMessage(message.id, { client: failingClient, db })).rejects.toBeInstanceOf(
      WhatsAppSendFailedError,
    );

    const updated = await db!.pendingWhatsAppMessage.findUnique({ where: { id: message.id } });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.failureReason).toContain("400");
  });

  it("refuses to send a message that isn't READY", async () => {
    const message = await enqueuePendingMessage(
      {
        businessId: fixture.businessId,
        conversationId: fixture.conversationId,
        whatsappPhoneNumberId: fixture.whatsappPhoneNumberId,
        toPhoneNumber: "+10000000002",
        body: "Hola",
      },
      db,
    );
    // still WAITING_APPROVAL — never approved

    await expect(sendReadyMessage(message.id, { client: fakeSenderClient(), db })).rejects.toBeInstanceOf(
      InvalidPendingMessageStatusTransitionError,
    );
  });

  it("throws PendingMessageNotFoundError for an unknown id", async () => {
    await expect(
      sendReadyMessage("00000000-0000-0000-0000-000000000000", { client: fakeSenderClient(), db }),
    ).rejects.toBeInstanceOf(PendingMessageNotFoundError);
  });
});
