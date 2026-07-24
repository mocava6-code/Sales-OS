import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvalidPendingMessageStatusTransitionError, PendingMessageNotFoundError } from "../errors";
import {
  applyStatusUpdate,
  enqueuePendingMessage,
  isPendingMessageStatusTransitionAllowed,
  listReadyMessages,
  markMessageCancelled,
  markMessageFailed,
  markMessageReady,
  markMessageSent,
  recordStatusEvent,
} from "../queue";
import {
  cleanupWhatsAppTestFixture,
  createWhatsAppTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type WhatsAppTestFixture,
} from "./test-db";

describe.skipIf(!shouldRunDbTests)("WhatsApp outbound queue — 8. outbound queue (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: WhatsAppTestFixture;

  beforeEach(async () => {
    fixture = await createWhatsAppTestFixture(db!, "queue");
  });

  afterEach(async () => {
    await cleanupWhatsAppTestFixture(db!, fixture);
  });

  it("enqueuePendingMessage always starts at WAITING_APPROVAL", async () => {
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

    expect(message.status).toBe("WAITING_APPROVAL");
    expect(message.externalId).toBeNull();
  });

  it("approve (WAITING_APPROVAL -> READY) then appears in listReadyMessages", async () => {
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

    const ready = await listReadyMessages(fixture.businessId, db);
    expect(ready.map((m) => m.id)).toContain(message.id);
  });

  it("reject (WAITING_APPROVAL -> CANCELLED) never appears in listReadyMessages", async () => {
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

    const cancelled = await markMessageCancelled(message.id, db);
    expect(cancelled.status).toBe("CANCELLED");

    const ready = await listReadyMessages(fixture.businessId, db);
    expect(ready.map((m) => m.id)).not.toContain(message.id);
  });

  it("9. markMessageSent (READY -> SENT) also records a SENT status event atomically", async () => {
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

    const sent = await markMessageSent(message.id, "wamid.SENT1", db);

    expect(sent.status).toBe("SENT");
    expect(sent.externalId).toBe("wamid.SENT1");
    expect(sent.sentAt).not.toBeNull();

    const events = await db!.whatsAppMessageStatusEvent.findMany({ where: { pendingMessageId: message.id } });
    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("SENT");

    // Observer Mode v1 — every outgoing WhatsApp message must be persisted
    // as a ConversationEntry too, the same way an inbound message is.
    const entry = await db!.conversationEntry.findUnique({ where: { id: sent.conversationEntryId } });
    expect(entry).not.toBeNull();
    expect(entry?.direction).toBe("OUTBOUND");
    expect(entry?.content).toBe("Hola");
    expect(entry?.externalId).toBe("wamid.SENT1");

    const conversation = await db!.conversation.findUnique({ where: { id: fixture.conversationId } });
    expect(conversation?.lastEntryDirection).toBe("OUTBOUND");
    expect(conversation?.status).toBe("WAITING_ON_CUSTOMER");
  });

  it("markMessageFailed (READY -> FAILED) records the failure reason", async () => {
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

    const failed = await markMessageFailed(message.id, "Graph API returned 400.", db);

    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toBe("Graph API returned 400.");
  });

  it("rejects an invalid transition (SENT -> READY) without writing anything", async () => {
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
    await markMessageSent(message.id, "wamid.SENT2", db);

    await expect(markMessageReady(message.id, db)).rejects.toBeInstanceOf(InvalidPendingMessageStatusTransitionError);

    const unchanged = await db!.pendingWhatsAppMessage.findUnique({ where: { id: message.id } });
    expect(unchanged?.status).toBe("SENT");
  });

  it("throws PendingMessageNotFoundError for an unknown id", async () => {
    await expect(markMessageReady("00000000-0000-0000-0000-000000000000", db)).rejects.toBeInstanceOf(
      PendingMessageNotFoundError,
    );
  });

  it("10. applyStatusUpdate records DELIVERED then READ as chronological history without changing workflow status", async () => {
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
    await markMessageSent(message.id, "wamid.STATUS1", db);

    await applyStatusUpdate(
      { externalId: "wamid.STATUS1", status: "DELIVERED", occurredAt: new Date("2026-07-20T12:00:00.000Z") },
      db,
    );
    await applyStatusUpdate(
      { externalId: "wamid.STATUS1", status: "READ", occurredAt: new Date("2026-07-20T12:05:00.000Z") },
      db,
    );

    const events = await db!.whatsAppMessageStatusEvent.findMany({
      where: { pendingMessageId: message.id },
      orderBy: { occurredAt: "asc" },
    });
    expect(events.map((e) => e.status)).toEqual(["SENT", "DELIVERED", "READ"]);

    const stillSent = await db!.pendingWhatsAppMessage.findUnique({ where: { id: message.id } });
    expect(stillSent?.status).toBe("SENT");
  });

  it("applyStatusUpdate with FAILED also updates the message's workflow status", async () => {
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
    await markMessageSent(message.id, "wamid.STATUS2", db);

    await applyStatusUpdate(
      {
        externalId: "wamid.STATUS2",
        status: "FAILED",
        occurredAt: new Date(),
        errorCode: "131047",
        errorMessage: "Re-engagement message",
      },
      db,
    );

    const updated = await db!.pendingWhatsAppMessage.findUnique({ where: { id: message.id } });
    expect(updated?.status).toBe("FAILED");
    expect(updated?.failureReason).toBe("Re-engagement message");
  });

  it("applyStatusUpdate for an unknown externalId safely exits (returns null, writes nothing)", async () => {
    const result = await applyStatusUpdate(
      { externalId: "wamid.NEVER-SENT-BY-US", status: "DELIVERED", occurredAt: new Date() },
      db,
    );
    expect(result).toBeNull();
  });

  it("4. duplicate status events safely exit — recordStatusEvent returns null on a repeat", async () => {
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
    await markMessageSent(message.id, "wamid.DUP1", db);

    const first = await recordStatusEvent(
      { pendingMessageId: message.id, status: "DELIVERED", occurredAt: new Date() },
      db,
    );
    const duplicate = await recordStatusEvent(
      { pendingMessageId: message.id, status: "DELIVERED", occurredAt: new Date() },
      db,
    );

    expect(first).not.toBeNull();
    expect(duplicate).toBeNull();

    const events = await db!.whatsAppMessageStatusEvent.findMany({
      where: { pendingMessageId: message.id, status: "DELIVERED" },
    });
    expect(events).toHaveLength(1);
  });
});

describe("isPendingMessageStatusTransitionAllowed — pure policy", () => {
  it("allows the full happy path", () => {
    expect(isPendingMessageStatusTransitionAllowed("WAITING_APPROVAL", "READY")).toBe(true);
    expect(isPendingMessageStatusTransitionAllowed("READY", "SENT")).toBe(true);
  });

  it("allows cancellation from either non-terminal state", () => {
    expect(isPendingMessageStatusTransitionAllowed("WAITING_APPROVAL", "CANCELLED")).toBe(true);
    expect(isPendingMessageStatusTransitionAllowed("READY", "CANCELLED")).toBe(true);
  });

  it("rejects transitions out of terminal states", () => {
    expect(isPendingMessageStatusTransitionAllowed("SENT", "READY")).toBe(false);
    expect(isPendingMessageStatusTransitionAllowed("FAILED", "READY")).toBe(false);
    expect(isPendingMessageStatusTransitionAllowed("CANCELLED", "READY")).toBe(false);
  });

  it("rejects skipping the approval step", () => {
    expect(isPendingMessageStatusTransitionAllowed("WAITING_APPROVAL", "SENT")).toBe(false);
  });
});
