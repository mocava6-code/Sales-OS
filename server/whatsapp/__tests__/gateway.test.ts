import { describe, expect, it, vi } from "vitest";
import { UnknownPhoneNumberError } from "../errors";
import { createWhatsAppGateway, type WhatsAppGatewayDependencies, type WhatsAppPhoneNumberRecord } from "../gateway";
import type { NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "../types";

interface FakeLead {
  id: string;
  businessId: string;
  phone: string;
  assignedToUserId: string | null;
}

interface FakeConversation {
  id: string;
  businessId: string;
  leadId: string;
  whatsappPhoneNumberId: string;
}

interface FakeEntry {
  id: string;
  externalId: string;
  conversationId: string;
}

function createFakeGatewayDeps(
  overrides: {
    phoneNumbers?: WhatsAppPhoneNumberRecord[];
    leadAssignments?: Record<string, string>; // phone -> advisorUserId
    runAnalysisImpl?: WhatsAppGatewayDependencies["runAnalysis"];
  } = {},
) {
  let idCounter = 0;
  const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

  const phoneNumbers = new Map((overrides.phoneNumbers ?? []).map((p) => [p.phoneNumberId, p]));
  const leads = new Map<string, FakeLead>();
  const conversations = new Map<string, FakeConversation>();
  const entries = new Map<string, FakeEntry>();

  const runAnalysis = vi.fn(
    overrides.runAnalysisImpl ??
      (async () => ({
        conversationIntelligence: {} as never,
        conversationSnapshotId: "snapshot-1",
        decisions: [],
        events: [],
        warnings: [],
      })),
  );

  const applyStatusUpdate = vi.fn(async () => ({ id: "event-1" }) as unknown);
  const enqueueMessage = vi.fn(async () => ({ id: nextId("pending") }));

  const deps: WhatsAppGatewayDependencies = {
    findPhoneNumberByPhoneNumberId: async (phoneNumberId) => phoneNumbers.get(phoneNumberId) ?? null,
    findOrCreateLead: async (businessId, phone) => {
      const existing = [...leads.values()].find((l) => l.businessId === businessId && l.phone === phone);
      if (existing) return existing;
      const lead: FakeLead = { id: nextId("lead"), businessId, phone, assignedToUserId: overrides.leadAssignments?.[phone] ?? null };
      leads.set(lead.id, lead);
      return lead;
    },
    findOrCreateConversation: async (businessId, leadId, whatsappPhoneNumberId) => {
      const existing = [...conversations.values()].find((c) => c.businessId === businessId && c.leadId === leadId);
      if (existing) return existing;
      const conversation: FakeConversation = { id: nextId("conv"), businessId, leadId, whatsappPhoneNumberId };
      conversations.set(conversation.id, conversation);
      return conversation;
    },
    findEntryByExternalId: async (externalId) => [...entries.values()].find((e) => e.externalId === externalId) ?? null,
    appendEntry: async (conversationId, entry) => {
      const created: FakeEntry = { id: nextId("entry"), externalId: entry.externalId, conversationId };
      entries.set(created.id, created);
      return created;
    },
    loadConversationForAnalysis: async () => ({ channel: "WHATSAPP", entries: [] }),
    runAnalysis,
    applyStatusUpdate,
    enqueueMessage,
  };

  return { deps, store: { phoneNumbers, leads, conversations, entries }, runAnalysis, applyStatusUpdate, enqueueMessage };
}

function textMessage(overrides: Partial<NormalizedWhatsAppMessage> = {}): NormalizedWhatsAppMessage {
  return {
    externalId: "wamid.MSG1",
    phoneNumberId: "phone-number-id-1",
    fromPhoneNumber: "16315551234",
    messageType: "TEXT",
    content: "Hola",
    occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    raw: {},
    ...overrides,
  };
}

describe("WhatsAppGateway.handleInboundMessage — 5/6. conversation creation and lookup", () => {
  it("creates a lead and conversation for a first-time sender", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.duplicate).toBe(false);
    expect(result.businessId).toBe("biz-1");
    expect(store.leads.size).toBe(1);
    expect(store.conversations.size).toBe(1);
  });

  it("reuses the same conversation for a second message from the same lead", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const first = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.MSG1" }));
    const second = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.MSG2" }));

    expect(first.conversationId).toBe(second.conversationId);
    expect(store.conversations.size).toBe(1);
    expect(store.entries.size).toBe(2);
  });
});

describe("WhatsAppGateway.handleInboundMessage — 4. duplicate detection", () => {
  it("safely exits on a duplicate externalId without creating a second entry or re-running analysis", async () => {
    const { deps, store, runAnalysis } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const first = await gateway.handleInboundMessage(textMessage());
    const duplicate = await gateway.handleInboundMessage(textMessage());

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.analysisTriggered).toBe(false);
    expect(store.entries.size).toBe(1);
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });
});

describe("WhatsAppGateway.handleInboundMessage — 7. orchestration trigger", () => {
  it("calls runAnalysis with the resolved businessId and conversationId", async () => {
    const { deps, runAnalysis } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(runAnalysis).toHaveBeenCalledTimes(1);
    expect(runAnalysis.mock.calls[0][0]).toMatchObject({
      businessId: "biz-1",
      conversationId: result.conversationId,
    });
    expect(result.analysisTriggered).toBe(true);
  });

  it("swallows an orchestration failure — never throws, but reports it in the result", async () => {
    const failingRunAnalysis = vi.fn(async () => {
      throw new Error("AI provider unavailable");
    });
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      runAnalysisImpl: failingRunAnalysis,
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.duplicate).toBe(false);
    expect(result.analysisTriggered).toBe(false);
    expect(result.analysisError).toBeInstanceOf(Error);
  });
});

describe("WhatsAppGateway.handleInboundMessage — 12. multiple businesses", () => {
  it("resolves distinct businesses even when the same customer number messages both", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [
        { id: "wpn-biz1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" },
        { id: "wpn-biz2", businessId: "biz-2", phoneNumberId: "phone-number-id-2" },
      ],
    });
    const gateway = createWhatsAppGateway(deps);

    const toBusiness1 = await gateway.handleInboundMessage(
      textMessage({ externalId: "wamid.A", phoneNumberId: "phone-number-id-1", fromPhoneNumber: "16315551234" }),
    );
    const toBusiness2 = await gateway.handleInboundMessage(
      textMessage({ externalId: "wamid.B", phoneNumberId: "phone-number-id-2", fromPhoneNumber: "16315551234" }),
    );

    expect(toBusiness1.businessId).toBe("biz-1");
    expect(toBusiness2.businessId).toBe("biz-2");
    expect(toBusiness1.leadId).not.toBe(toBusiness2.leadId);
    expect(toBusiness1.conversationId).not.toBe(toBusiness2.conversationId);
    expect(store.leads.size).toBe(2);
  });
});

describe("WhatsAppGateway.handleInboundMessage — 13. multiple phone numbers per business", () => {
  it("routes messages arriving on either registered number of the same business correctly", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [
        { id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" },
        { id: "wpn-2", businessId: "biz-1", phoneNumberId: "phone-number-id-2" },
      ],
    });
    const gateway = createWhatsAppGateway(deps);

    const viaNumber1 = await gateway.handleInboundMessage(
      textMessage({ externalId: "wamid.A", phoneNumberId: "phone-number-id-1", fromPhoneNumber: "16315551111" }),
    );
    const viaNumber2 = await gateway.handleInboundMessage(
      textMessage({ externalId: "wamid.B", phoneNumberId: "phone-number-id-2", fromPhoneNumber: "16315552222" }),
    );

    expect(viaNumber1.businessId).toBe("biz-1");
    expect(viaNumber2.businessId).toBe("biz-1");
    expect(store.conversations.get(viaNumber1.conversationId!)?.whatsappPhoneNumberId).toBe("wpn-1");
    expect(store.conversations.get(viaNumber2.conversationId!)?.whatsappPhoneNumberId).toBe("wpn-2");
  });

  it("throws UnknownPhoneNumberError for a phoneNumberId that isn't registered to any business", async () => {
    const { deps } = createFakeGatewayDeps({ phoneNumbers: [] });
    const gateway = createWhatsAppGateway(deps);

    await expect(gateway.handleInboundMessage(textMessage())).rejects.toBeInstanceOf(UnknownPhoneNumberError);
  });
});

describe("WhatsAppGateway.handleInboundMessage — 14. advisor resolution", () => {
  it("surfaces the lead's assigned advisor as advisorUserId", async () => {
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      leadAssignments: { "16315551234": "advisor-1" },
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage({ fromPhoneNumber: "16315551234" }));

    expect(result.advisorUserId).toBe("advisor-1");
  });

  it("resolves advisorUserId to null when the lead is unassigned", async () => {
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.advisorUserId).toBeNull();
  });
});

describe("WhatsAppGateway.handleStatusEvent", () => {
  function statusEvent(overrides: Partial<NormalizedWhatsAppStatus> = {}): NormalizedWhatsAppStatus {
    return {
      externalId: "wamid.OUT1",
      phoneNumberId: "phone-number-id-1",
      recipientPhoneNumber: "16315551234",
      status: "DELIVERED",
      occurredAt: new Date(),
      raw: {},
      ...overrides,
    };
  }

  it("reports applied:true when applyStatusUpdate records the event", async () => {
    const { deps, applyStatusUpdate } = createFakeGatewayDeps({ phoneNumbers: [] });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleStatusEvent(statusEvent());

    expect(result.applied).toBe(true);
    expect(applyStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: "wamid.OUT1", status: "DELIVERED" }),
    );
  });

  it("reports applied:false when applyStatusUpdate returns null (unknown/duplicate)", async () => {
    const { deps } = createFakeGatewayDeps({ phoneNumbers: [] });
    const gateway = createWhatsAppGateway({ ...deps, applyStatusUpdate: async () => null });

    const result = await gateway.handleStatusEvent(statusEvent());

    expect(result.applied).toBe(false);
  });
});

describe("WhatsAppGateway.enqueueOutboundMessage", () => {
  it("delegates to the injected enqueueMessage dependency", async () => {
    const { deps, enqueueMessage } = createFakeGatewayDeps({ phoneNumbers: [] });
    const gateway = createWhatsAppGateway(deps);

    await gateway.enqueueOutboundMessage({
      businessId: "biz-1",
      conversationId: "conv-1",
      whatsappPhoneNumberId: "wpn-1",
      toPhoneNumber: "16315551234",
      body: "Hola",
    });

    expect(enqueueMessage).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: "biz-1", conversationId: "conv-1", body: "Hola" }),
    );
  });
});
