import { describe, expect, it } from "vitest";
import {
  approveWhatsAppReplyHandler,
  importHistoricalWhatsAppChatHandler,
  previewHistoricalImportHandler,
  queueWhatsAppReplyHandler,
  registerWhatsAppPhoneNumberHandler,
  rejectWhatsAppReplyHandler,
  sendQueuedReplyHandler,
} from "../whatsapp-actions";
import { NotFoundError } from "../errors";
import { DuplicatePhoneNumberError } from "@/server/whatsapp/errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

const advisor = { id: "user-1", businessId: "biz-1", role: "SALESPERSON" as const };
const owner = { id: "user-2", businessId: "biz-1", role: "OWNER" as const };

function fakeDb(businessNames: string[] = ["Koriaki"]) {
  return { user: { findMany: async () => businessNames.map((name) => ({ name })) } } as never;
}

const TWO_PARTICIPANT_CHAT = [
  "27/07/26, 14:05 - Juan Pérez: Hola, quisiera saber el precio",
  "27/07/26, 14:07 - Koriaki: ¡Hola! Claro, ¿qué producto te interesa?",
  "27/07/26, 14:08 - Juan Pérez: El modelo azul",
].join("\n");

const AMBIGUOUS_TWO_PARTICIPANT_CHAT = [
  "27/07/26, 14:05 - Juan Pérez: Hola",
  "27/07/26, 14:07 - María López: ¡Hola!",
].join("\n");

const GROUP_CHAT = [
  "27/07/26, 14:05 - Juan Pérez: Hola a todos",
  "27/07/26, 14:07 - María López: Hola",
  "27/07/26, 14:08 - Koriaki: Bienvenidos",
].join("\n");

const CHAT_WITH_BAD_TIMESTAMP = [
  "27/07/26, 14:05 - Juan Pérez: Hola, quisiera saber el precio",
  "40/13/26, 14:06 - Koriaki: mensaje con fecha inválida",
].join("\n");

function phoneNumberRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "wpn-1",
    businessId: "biz-1",
    phoneNumberId: "843458045523703",
    displayPhoneNumber: "+51 999 999 999",
    wabaId: "860448446409411",
    label: null,
    createdAt: new Date(),
    ...overrides,
  } as never;
}

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

describe("registerWhatsAppPhoneNumberHandler", () => {
  it("returns UNAUTHENTICATED without registering when there's no session", async () => {
    let called = false;
    const result = await registerWhatsAppPhoneNumberHandler(
      { phoneNumberId: "843458045523703", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411" },
      {
        resolver: createFakeAuthContextResolver(null),
        register: async () => {
          called = true;
          throw new Error("should never be called");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(called).toBe(false);
  });

  it("returns FORBIDDEN for a non-OWNER, without registering", async () => {
    let called = false;
    const result = await registerWhatsAppPhoneNumberHandler(
      { phoneNumberId: "843458045523703", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411" },
      {
        resolver: createFakeAuthContextResolver(advisor),
        register: async () => {
          called = true;
          throw new Error("should never be called");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(called).toBe(false);
  });

  it("rejects a non-numeric phoneNumberId before registering", async () => {
    let called = false;
    const result = await registerWhatsAppPhoneNumberHandler(
      { phoneNumberId: "not-a-number", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411" },
      {
        resolver: createFakeAuthContextResolver(owner),
        register: async () => {
          called = true;
          throw new Error("should never be called");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(called).toBe(false);
  });

  it("registers the number scoped to the owner's business", async () => {
    let capturedBusinessId: string | undefined;
    let capturedInput: unknown;
    const result = await registerWhatsAppPhoneNumberHandler(
      { phoneNumberId: "843458045523703", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411", label: "Main line" },
      {
        resolver: createFakeAuthContextResolver(owner),
        register: async (businessId, input) => {
          capturedBusinessId = businessId;
          capturedInput = input;
          return phoneNumberRow({ label: input.label ?? null });
        },
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.phoneNumberId).toBe("843458045523703");
      expect(result.data.label).toBe("Main line");
    }
    expect(capturedBusinessId).toBe("biz-1");
    expect(capturedInput).toMatchObject({ phoneNumberId: "843458045523703", wabaId: "860448446409411" });
  });

  it("maps a duplicate phoneNumberId to an INVALID_INPUT field error", async () => {
    const result = await registerWhatsAppPhoneNumberHandler(
      { phoneNumberId: "843458045523703", displayPhoneNumber: "+51 999 999 999", wabaId: "860448446409411" },
      {
        resolver: createFakeAuthContextResolver(owner),
        register: async () => {
          throw new DuplicatePhoneNumberError("843458045523703");
        },
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_INPUT");
      expect(result.error.fieldErrors?.phoneNumberId?.[0]).toContain("843458045523703");
    }
  });
});

describe("previewHistoricalImportHandler", () => {
  it("returns UNAUTHENTICATED without touching the database when there's no session", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: TWO_PARTICIPANT_CHAT, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(null), db: fakeDb() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns FORBIDDEN for a non-OWNER", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: TWO_PARTICIPANT_CHAT, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(advisor), db: fakeDb() },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
  });

  it("resolves a 2-participant chat against a known business name and suggests a phone only when the customer label looks like one", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: TWO_PARTICIPANT_CHAT, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Koriaki"]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.data.status === "READY_TO_IMPORT") {
      expect(result.data.messageCount).toBe(3);
      expect(result.data.unparseableTimestampCount).toBe(0);
      expect(result.data.suggestedCustomerPhone).toBeNull(); // "Juan Pérez" isn't phone-shaped
    } else {
      throw new Error("expected READY_TO_IMPORT");
    }
  });

  it("suggests the customer phone when the unsaved-contact label is phone-shaped", async () => {
    const chat = TWO_PARTICIPANT_CHAT.replace(/Juan Pérez/g, "+51 999 999 999");
    const result = await previewHistoricalImportHandler(
      { rawText: chat, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Koriaki"]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.data.status === "READY_TO_IMPORT") {
      expect(result.data.suggestedCustomerPhone).toBe("+51 999 999 999");
    } else {
      throw new Error("expected READY_TO_IMPORT");
    }
  });

  it("returns NEEDS_PARTICIPANT_RESOLUTION for an ambiguous 2-participant chat with no known-business match", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: AMBIGUOUS_TWO_PARTICIPANT_CHAT, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Someone Else"]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.status).toBe("NEEDS_PARTICIPANT_RESOLUTION");
      if (result.data.status === "NEEDS_PARTICIPANT_RESOLUTION") {
        expect(result.data.candidateLabels).toHaveLength(2);
      }
    }
  });

  it("resolves an ambiguous chat once manualBusinessSenderLabel is supplied", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: AMBIGUOUS_TWO_PARTICIPANT_CHAT, timezone: "America/Lima", manualBusinessSenderLabel: "María López" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Someone Else"]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.status).toBe("READY_TO_IMPORT");
  });

  it("rejects a 3+ participant (group) chat as INVALID_INPUT", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: GROUP_CHAT, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Koriaki"]) },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("counts unparseable timestamps without dropping the chat", async () => {
    const result = await previewHistoricalImportHandler(
      { rawText: CHAT_WITH_BAD_TIMESTAMP, timezone: "America/Lima" },
      { resolver: createFakeAuthContextResolver(owner), db: fakeDb(["Koriaki"]) },
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.data.status === "READY_TO_IMPORT") {
      expect(result.data.unparseableTimestampCount).toBe(1);
    } else {
      throw new Error("expected READY_TO_IMPORT");
    }
  });
});

describe("importHistoricalWhatsAppChatHandler", () => {
  const baseInput = { rawText: TWO_PARTICIPANT_CHAT, timezone: "America/Lima", phone: "+10000000005" };

  it("returns UNAUTHENTICATED without calling findOrCreateLead when there's no session", async () => {
    let called = false;
    const result = await importHistoricalWhatsAppChatHandler(baseInput, {
      resolver: createFakeAuthContextResolver(null),
      db: fakeDb(),
      findOrCreateLead: async () => {
        called = true;
        throw new Error("should never be called");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(called).toBe(false);
  });

  it("returns FORBIDDEN for a non-OWNER, without calling findOrCreateLead", async () => {
    let called = false;
    const result = await importHistoricalWhatsAppChatHandler(baseInput, {
      resolver: createFakeAuthContextResolver(advisor),
      db: fakeDb(),
      findOrCreateLead: async () => {
        called = true;
        throw new Error("should never be called");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("FORBIDDEN");
    expect(called).toBe(false);
  });

  it("rejects a group/unresolved chat as INVALID_INPUT without calling findOrCreateLead or importEntries", async () => {
    let leadCalled = false;
    let importCalled = false;
    const result = await importHistoricalWhatsAppChatHandler(
      { rawText: GROUP_CHAT, timezone: "America/Lima", phone: "+10000000005" },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => {
          leadCalled = true;
          return { id: "lead-1" };
        },
        importEntries: async () => {
          importCalled = true;
          return { conversationId: "conv-1", conversationCreated: true, createdCount: 0, duplicateCount: 0 };
        },
      },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
    expect(leadCalled).toBe(false);
    expect(importCalled).toBe(false);
  });

  it("imports a resolved chat, filtering out the unparseable-timestamp message before it reaches importEntries", async () => {
    let capturedEntries: unknown;
    const result = await importHistoricalWhatsAppChatHandler(
      { rawText: CHAT_WITH_BAD_TIMESTAMP, timezone: "America/Lima", phone: "+10000000005" },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => ({ id: "lead-1" }),
        importEntries: async (_businessId, _leadId, entries) => {
          capturedEntries = entries;
          return { conversationId: "conv-1", conversationCreated: true, createdCount: entries.length, duplicateCount: 0 };
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.leadId).toBe("lead-1");
      expect(result.data.createdCount).toBe(1);
      expect(result.data.skippedUnparseableTimestampCount).toBe(1);
    }
    expect(Array.isArray(capturedEntries)).toBe(true);
    expect((capturedEntries as unknown[]).length).toBe(1);
  });

  it("never runs analysis when runAnalysis is false", async () => {
    let analysisCalled = false;
    const result = await importHistoricalWhatsAppChatHandler(
      { ...baseInput, runAnalysis: false },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => ({ id: "lead-1" }),
        importEntries: async () => ({ conversationId: "conv-1", conversationCreated: true, createdCount: 3, duplicateCount: 0 }),
        runAnalysis: async () => {
          analysisCalled = true;
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.analysisTriggered).toBe(false);
    expect(analysisCalled).toBe(false);
  });

  it("skips analysis when the import was a full no-op (createdCount 0), even if runAnalysis is true", async () => {
    let analysisCalled = false;
    const result = await importHistoricalWhatsAppChatHandler(
      { ...baseInput, runAnalysis: true },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => ({ id: "lead-1" }),
        importEntries: async () => ({ conversationId: "conv-1", conversationCreated: false, createdCount: 0, duplicateCount: 3 }),
        runAnalysis: async () => {
          analysisCalled = true;
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.analysisTriggered).toBe(false);
    expect(analysisCalled).toBe(false);
  });

  it("runs analysis once when runAnalysis is true and entries were actually created", async () => {
    let analysisCalled = false;
    const result = await importHistoricalWhatsAppChatHandler(
      { ...baseInput, runAnalysis: true },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => ({ id: "lead-1" }),
        importEntries: async () => ({ conversationId: "conv-1", conversationCreated: true, createdCount: 3, duplicateCount: 0 }),
        runAnalysis: async () => {
          analysisCalled = true;
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.analysisTriggered).toBe(true);
    expect(analysisCalled).toBe(true);
  });

  it("marks the import successful (analysisTriggered: false) when analysis throws, without undoing the import", async () => {
    const result = await importHistoricalWhatsAppChatHandler(
      { ...baseInput, runAnalysis: true },
      {
        resolver: createFakeAuthContextResolver(owner),
        db: fakeDb(["Koriaki"]),
        findOrCreateLead: async () => ({ id: "lead-1" }),
        importEntries: async () => ({ conversationId: "conv-1", conversationCreated: true, createdCount: 3, duplicateCount: 0 }),
        runAnalysis: async () => {
          throw new Error("AI provider unavailable");
        },
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.createdCount).toBe(3);
      expect(result.data.analysisTriggered).toBe(false);
    }
  });
});
