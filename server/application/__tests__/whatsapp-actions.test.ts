import { describe, expect, it } from "vitest";
import {
  approveWhatsAppReplyHandler,
  queueWhatsAppReplyHandler,
  rejectWhatsAppReplyHandler,
  sendQueuedReplyHandler,
} from "../whatsapp-actions";
import { NotFoundError } from "../errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

const advisor = { id: "user-1", businessId: "biz-1", role: "SALESPERSON" as const };

function pendingMessageRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "pending-1",
    businessId: "biz-1",
    conversationId: "conv-1",
    whatsappPhoneNumberId: "wpn-1",
    toPhoneNumber: "+10000000002",
    body: "Hola",
    status: "WAITING_APPROVAL",
    decisionRecordId: null,
    createdByUserId: "user-1",
    externalId: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    sentAt: null,
    ...overrides,
  } as never;
}

describe("queueWhatsAppReplyHandler", () => {
  it("returns UNAUTHENTICATED without loading the conversation when there's no session", async () => {
    let loadConversationCalled = false;
    const result = await queueWhatsAppReplyHandler(
      { conversationId: "conv-1", body: "Hola" },
      {
        resolver: createFakeAuthContextResolver(null),
        loadConversation: async () => {
          loadConversationCalled = true;
          throw new Error("should never be called");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(loadConversationCalled).toBe(false);
  });

  it("returns NOT_FOUND for a conversation belonging to another business", async () => {
    const result = await queueWhatsAppReplyHandler(
      { conversationId: "conv-1", body: "Hola" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadConversation: async () => {
          throw new NotFoundError("Conversation");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns INVALID_INPUT when the conversation has no WhatsApp number associated", async () => {
    const result = await queueWhatsAppReplyHandler(
      { conversationId: "conv-1", body: "Hola" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadConversation: async () => ({
          id: "conv-1",
          businessId: "biz-1",
          leadPhone: "+10000000002",
          whatsappPhoneNumberId: null,
        }),
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("enqueues a message with the resolved recipient and creator", async () => {
    let capturedInput: unknown;
    const result = await queueWhatsAppReplyHandler(
      { conversationId: "conv-1", body: "Hola, aquí tienes la cotización." },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadConversation: async () => ({
          id: "conv-1",
          businessId: "biz-1",
          leadPhone: "+10000000002",
          whatsappPhoneNumberId: "wpn-1",
        }),
        enqueue: async (input) => {
          capturedInput = input;
          return pendingMessageRow({ body: input.body, toPhoneNumber: input.toPhoneNumber });
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("WAITING_APPROVAL");
      expect(result.data.body).toBe("Hola, aquí tienes la cotización.");
    }
    expect(capturedInput).toMatchObject({
      businessId: "biz-1",
      conversationId: "conv-1",
      whatsappPhoneNumberId: "wpn-1",
      toPhoneNumber: "+10000000002",
      createdByUserId: "user-1",
    });
  });

  it("rejects an empty body before touching the conversation", async () => {
    let called = false;
    const result = await queueWhatsAppReplyHandler(
      { conversationId: "conv-1", body: "" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadConversation: async () => {
          called = true;
          throw new Error("should not be reached");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(called).toBe(false);
  });
});

describe("approveWhatsAppReplyHandler", () => {
  it("returns UNAUTHENTICATED when there's no session", async () => {
    const result = await approveWhatsAppReplyHandler(
      { pendingMessageId: "pending-1" },
      { resolver: createFakeAuthContextResolver(null) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
  });

  it("approves (WAITING_APPROVAL -> READY) after resolving tenant ownership", async () => {
    const result = await approveWhatsAppReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadPendingMessage: async () => ({ id: "pending-1", businessId: "biz-1", status: "WAITING_APPROVAL" }),
        markReady: async (id) => pendingMessageRow({ id, status: "READY" }),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("READY");
  });

  it("returns NOT_FOUND for a message belonging to another business", async () => {
    const result = await approveWhatsAppReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadPendingMessage: async () => {
          throw new NotFoundError("Message");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("rejectWhatsAppReplyHandler", () => {
  it("cancels the message after resolving tenant ownership", async () => {
    const result = await rejectWhatsAppReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadPendingMessage: async () => ({ id: "pending-1", businessId: "biz-1", status: "WAITING_APPROVAL" }),
        markCancelled: async (id) => pendingMessageRow({ id, status: "CANCELLED" }),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("CANCELLED");
  });
});

describe("sendQueuedReplyHandler", () => {
  it("returns UNAUTHENTICATED without constructing a sender client when there's no session", async () => {
    let senderConstructed = false;
    const result = await sendQueuedReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(null),
        get senderClient() {
          senderConstructed = true;
          return { sendTextMessage: async () => ({ externalId: "x" }) };
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(senderConstructed).toBe(false);
  });

  it("sends a READY message using the injected client and sendReady function", async () => {
    let capturedClient: unknown;
    const result = await sendQueuedReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadPendingMessage: async () => ({ id: "pending-1", businessId: "biz-1", status: "READY" }),
        senderClient: { sendTextMessage: async () => ({ externalId: "wamid.SENT1" }) },
        sendReady: async (id, deps) => {
          capturedClient = deps.client;
          return pendingMessageRow({ id, status: "SENT", externalId: "wamid.SENT1" });
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("SENT");
      expect(result.data.externalId).toBe("wamid.SENT1");
    }
    expect(capturedClient).toBeDefined();
  });

  it("returns NOT_FOUND for a message belonging to another business, before touching the sender", async () => {
    const result = await sendQueuedReplyHandler(
      { pendingMessageId: "pending-1" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        loadPendingMessage: async () => {
          throw new NotFoundError("Message");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});
