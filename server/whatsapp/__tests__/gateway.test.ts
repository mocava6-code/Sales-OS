import { describe, expect, it, vi } from "vitest";
import { UnknownPhoneNumberError } from "../errors";
import { createWhatsAppGateway, type WhatsAppGatewayDependencies, type WhatsAppPhoneNumberRecord } from "../gateway";
import type { NormalizedWhatsAppBusinessAppMessage, NormalizedWhatsAppMessage, NormalizedWhatsAppStatus } from "../types";

interface FakeLead {
  id: string;
  businessId: string;
  name: string;
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
  direction: "INBOUND" | "OUTBOUND";
  occurredAt: Date;
}

function createFakeGatewayDeps(
  overrides: {
    phoneNumbers?: WhatsAppPhoneNumberRecord[];
    leadAssignments?: Record<string, string>; // phone -> advisorUserId
    runAnalysisImpl?: WhatsAppGatewayDependencies["runAnalysis"];
    recordDomainEventImpl?: WhatsAppGatewayDependencies["recordDomainEvent"];
    projectCommercialProfileImpl?: WhatsAppGatewayDependencies["projectCommercialProfile"];
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

  const recordDomainEvent = vi.fn(
    overrides.recordDomainEventImpl ?? (async () => ({ domainEvent: {} as never, observations: [] })),
  );

  const applyStatusUpdate = vi.fn(async () => ({ id: "event-1" }) as unknown);
  const enqueueMessage = vi.fn(async () => ({ id: nextId("pending") }));
  const projectCommercialProfile = vi.fn(
    overrides.projectCommercialProfileImpl ?? (async () => ({ created: true, updated: false, skipped: false })),
  );

  const deps: WhatsAppGatewayDependencies = {
    findPhoneNumberByPhoneNumberId: async (phoneNumberId) => phoneNumbers.get(phoneNumberId) ?? null,
    findOrCreateLead: async (businessId, phone) => {
      const existing = [...leads.values()].find((l) => l.businessId === businessId && l.phone === phone);
      if (existing) return existing;
      const lead: FakeLead = { id: nextId("lead"), businessId, name: phone, phone, assignedToUserId: overrides.leadAssignments?.[phone] ?? null };
      leads.set(lead.id, lead);
      return lead;
    },
    // Mirrors applyWhatsAppContactName's real placeholder-only-upgrade rule
    // against the in-memory `leads` map — never the real DB (this suite
    // passes no `db` override to createWhatsAppGateway, so the real default
    // would otherwise hit the production Prisma singleton).
    applyContactName: async (lead, contactName) => {
      const trimmed = contactName?.trim();
      if (!trimmed) return { updated: false, name: lead.name };
      if (lead.name !== lead.phone) return { updated: false, name: lead.name };
      if (trimmed === lead.name) return { updated: false, name: lead.name };
      const existing = leads.get(lead.id);
      if (existing) existing.name = trimmed;
      return { updated: true, name: trimmed };
    },
    findOrCreateConversation: async (businessId, leadId, whatsappPhoneNumberId) => {
      const existing = [...conversations.values()].find((c) => c.businessId === businessId && c.leadId === leadId);
      if (existing) return { id: existing.id, created: false };
      const conversation: FakeConversation = { id: nextId("conv"), businessId, leadId, whatsappPhoneNumberId };
      conversations.set(conversation.id, conversation);
      return { id: conversation.id, created: true };
    },
    findEntryByExternalId: async (externalId) => [...entries.values()].find((e) => e.externalId === externalId) ?? null,
    findLatestEntry: async (conversationId) => {
      const conversationEntries = [...entries.values()].filter((e) => e.conversationId === conversationId);
      if (!conversationEntries.length) return null;
      const latest = conversationEntries.reduce((a, b) => (a.occurredAt > b.occurredAt ? a : b));
      return { direction: latest.direction, occurredAt: latest.occurredAt };
    },
    appendEntry: async (conversationId, entry) => {
      const created: FakeEntry = {
        id: nextId("entry"),
        externalId: entry.externalId,
        conversationId,
        direction: entry.direction,
        occurredAt: entry.occurredAt,
      };
      entries.set(created.id, created);
      return created;
    },
    loadConversationForAnalysis: async () => ({ channel: "WHATSAPP", entries: [] }),
    runAnalysis,
    recordDomainEvent,
    applyStatusUpdate,
    enqueueMessage,
    projectCommercialProfile,
  };

  return {
    deps,
    store: { phoneNumbers, leads, conversations, entries },
    runAnalysis,
    recordDomainEvent,
    applyStatusUpdate,
    enqueueMessage,
    projectCommercialProfile,
  };
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

  it("Kori Data Correctness Phase 1B — a new lead gets the WhatsApp contact profile name", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage({ contactName: "Juan Pérez" }));

    expect(result.contactNameUpdated).toBe(true);
    const lead = [...store.leads.values()][0];
    expect(lead.name).toBe("Juan Pérez");
  });

  it("Kori Data Correctness Phase 1B — a placeholder lead from an earlier message is upgraded once a contact name becomes available", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const first = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.NO_NAME" })); // no contactName — stays a phone placeholder
    expect(first.contactNameUpdated).toBe(false);

    const second = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.WITH_NAME", contactName: "María López" }));
    expect(second.contactNameUpdated).toBe(true);
    expect(store.leads.size).toBe(1); // same lead, matched by phone — not a second one
    expect([...store.leads.values()][0].name).toBe("María López");
  });

  it("Kori Data Correctness Phase 1B — never overwrites a name a human already edited", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    await gateway.handleInboundMessage(textMessage({ externalId: "wamid.FIRST", contactName: "Juan Pérez" }));
    const [lead] = [...store.leads.values()];
    lead.name = "Juan (cliente VIP)"; // simulates a human editing the Lead's name in the UI

    const result = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.SECOND", contactName: "A Totally Different Name" }));

    expect(result.contactNameUpdated).toBe(false);
    expect([...store.leads.values()][0].name).toBe("Juan (cliente VIP)");
  });

  it("Kori Data Correctness Phase 1B — missing contactName leaves the lead's name unchanged", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage()); // no contactName override — undefined

    expect(result.contactNameUpdated).toBe(false);
    expect([...store.leads.values()][0].name).toBe("16315551234"); // still the phone placeholder
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
    expect(duplicate.observationsRecorded).toBe(false);
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

describe("WhatsAppGateway.handleInboundMessage — 8. Kori Natural Language Analytics v0 Phase 1 commercial-profile projection", () => {
  it("1. calls projectCommercialProfile with the resolved businessId/leadId when analysis succeeds", async () => {
    const { deps, projectCommercialProfile } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.analysisTriggered).toBe(true);
    expect(projectCommercialProfile).toHaveBeenCalledTimes(1);
    expect(projectCommercialProfile).toHaveBeenCalledWith("biz-1", result.leadId);
    expect(result.profileProjected).toBe(true);
    expect(result.profileProjectionError).toBeUndefined();
  });

  it("2. still calls projectCommercialProfile when analysis fails — deterministic extraction must not depend on AI", async () => {
    const failingRunAnalysis = vi.fn(async () => {
      throw new Error("AI provider unavailable");
    });
    const { deps, projectCommercialProfile } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      runAnalysisImpl: failingRunAnalysis,
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.analysisTriggered).toBe(false);
    expect(result.analysisError).toBeInstanceOf(Error);
    expect(projectCommercialProfile).toHaveBeenCalledTimes(1);
    expect(projectCommercialProfile).toHaveBeenCalledWith("biz-1", result.leadId);
    expect(result.profileProjected).toBe(true);
  });

  it("3. still calls projectCommercialProfile when the AI provider is not configured — the exact production failure mode", async () => {
    const unconfiguredRunAnalysis = vi.fn(async () => {
      throw new Error("AI_PROVIDER is not configured. Set it in your environment (see .env.example).");
    });
    const { deps, store, projectCommercialProfile } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      runAnalysisImpl: unconfiguredRunAnalysis,
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    // Message persistence is the critical path — unaffected either way.
    expect(result.duplicate).toBe(false);
    expect(result.entryId).toBeDefined();
    expect(store.entries.size).toBe(1);
    // Analysis genuinely failed...
    expect(result.analysisTriggered).toBe(false);
    // ...but projection still ran regardless.
    expect(projectCommercialProfile).toHaveBeenCalledTimes(1);
    expect(result.profileProjected).toBe(true);
  });

  it("4. swallows a projection failure — never throws, message/entry are still persisted, result still returns normally", async () => {
    const failingProjection = vi.fn(async () => {
      throw new Error("projection unavailable");
    });
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      projectCommercialProfileImpl: failingProjection,
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.duplicate).toBe(false);
    expect(result.entryId).toBeDefined();
    expect(store.entries.size).toBe(1);
    expect(result.analysisTriggered).toBe(true);
    expect(result.profileProjected).toBe(false);
    expect(result.profileProjectionError).toBeInstanceOf(Error);
  });

  it("logs a sanitized, structured failure for a projection error — no message content in the log payload", async () => {
    const failingProjection = vi.fn(async () => {
      throw new Error("connection to database failed");
    });
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      projectCommercialProfileImpl: failingProjection,
    });
    const gateway = createWhatsAppGateway(deps);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await gateway.handleInboundMessage(textMessage({ content: "secret customer content that must never be logged" }));

    const call = consoleErrorSpy.mock.calls.find((c) => c[1]?.stage === "commercial_profile_projection");
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      businessId: "biz-1",
      leadId: result.leadId,
      conversationId: result.conversationId,
      stage: "commercial_profile_projection",
      errorCode: "Error",
      errorMessage: "connection to database failed",
    });
    const logged = JSON.stringify(call);
    expect(logged).not.toContain("secret customer content");
    consoleErrorSpy.mockRestore();
  });

  it("logs a sanitized, structured failure for an analysis error", async () => {
    const failingRunAnalysis = vi.fn(async () => {
      throw new Error("AI_PROVIDER is not configured. Set it in your environment (see .env.example).");
    });
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      runAnalysisImpl: failingRunAnalysis,
    });
    const gateway = createWhatsAppGateway(deps);
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await gateway.handleInboundMessage(textMessage());

    const call = consoleErrorSpy.mock.calls.find((c) => c[1]?.stage === "analysis");
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      businessId: "biz-1",
      leadId: result.leadId,
      conversationId: result.conversationId,
      stage: "analysis",
      errorCode: "Error",
      errorMessage: "AI_PROVIDER is not configured. Set it in your environment (see .env.example).",
    });
    consoleErrorSpy.mockRestore();
  });
});

describe("WhatsAppGateway.handleInboundMessage — Observer Mode v1 domain events", () => {
  it("records CONVERSATION_CREATED and MESSAGE_RECEIVED for a first-time sender", async () => {
    const { deps, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.observationsRecorded).toBe(true);
    expect(recordDomainEvent).toHaveBeenCalledTimes(2);
    expect(recordDomainEvent.mock.calls[0][0].event).toMatchObject({ type: "CONVERSATION_CREATED", conversationId: result.conversationId });
    expect(recordDomainEvent.mock.calls[1][0].event).toMatchObject({ type: "MESSAGE_RECEIVED", conversationId: result.conversationId });
  });

  it("records only MESSAGE_RECEIVED (no CONVERSATION_CREATED) for an existing conversation", async () => {
    const { deps, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    await gateway.handleInboundMessage(textMessage({ externalId: "wamid.MSG1" }));
    recordDomainEvent.mockClear();
    await gateway.handleInboundMessage(textMessage({ externalId: "wamid.MSG2" }));

    expect(recordDomainEvent).toHaveBeenCalledTimes(1);
    expect(recordDomainEvent.mock.calls[0][0].event).toMatchObject({ type: "MESSAGE_RECEIVED" });
  });

  it("records ATTACHMENT_RECEIVED in addition to MESSAGE_RECEIVED for a media message", async () => {
    const { deps, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    await gateway.handleInboundMessage(
      textMessage({
        messageType: "IMAGE",
        content: "[image]",
        media: { mediaId: "media-1", mimeType: "image/jpeg", caption: "check this out" },
      }),
    );

    const eventTypes = recordDomainEvent.mock.calls.map((call) => call[0].event.type);
    expect(eventTypes).toEqual(["CONVERSATION_CREATED", "MESSAGE_RECEIVED", "ATTACHMENT_RECEIVED"]);
  });

  it("does not record any domain events for a duplicate delivery", async () => {
    const { deps, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    await gateway.handleInboundMessage(textMessage());
    recordDomainEvent.mockClear();
    await gateway.handleInboundMessage(textMessage());

    expect(recordDomainEvent).not.toHaveBeenCalled();
  });

  it("swallows a domain-event recording failure — never throws, but reports it in the result", async () => {
    const failingRecordDomainEvent = vi.fn(async () => {
      throw new Error("persistence unavailable");
    });
    const { deps } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
      recordDomainEventImpl: failingRecordDomainEvent,
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleInboundMessage(textMessage());

    expect(result.duplicate).toBe(false);
    expect(result.observationsRecorded).toBe(false);
    expect(result.observationError).toBeInstanceOf(Error);
    // A failure to record the domain event must never block the rest of the pipeline.
    expect(result.analysisTriggered).toBe(true);
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

function echoMessage(overrides: Partial<NormalizedWhatsAppBusinessAppMessage> = {}): NormalizedWhatsAppBusinessAppMessage {
  return {
    externalId: "wamid.ECHO1",
    phoneNumberId: "phone-number-id-1",
    toPhoneNumber: "16315551234",
    subtype: "NEW",
    messageType: "TEXT",
    content: "On my way",
    occurredAt: new Date("2026-07-20T12:00:00.000Z"),
    raw: {},
    ...overrides,
  };
}

describe("WhatsAppGateway.handleBusinessAppEchoEvent — Coexistence", () => {
  it("persists a new echo as an OUTBOUND entry and creates a lead/conversation for a first-time recipient", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleBusinessAppEchoEvent(echoMessage());

    expect(result.duplicate).toBe(false);
    expect(result.businessId).toBe("biz-1");
    expect(store.entries.get(result.entryId!)?.direction).toBe("OUTBOUND");
    expect(store.leads.size).toBe(1);
    expect(store.conversations.size).toBe(1);
  });

  it("reuses an existing conversation for the same lead instead of creating a second one", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const inbound = await gateway.handleInboundMessage(textMessage({ externalId: "wamid.IN1", fromPhoneNumber: "16315551234" }));
    const echo = await gateway.handleBusinessAppEchoEvent(echoMessage({ toPhoneNumber: "16315551234" }));

    expect(echo.conversationId).toBe(inbound.conversationId);
    expect(store.conversations.size).toBe(1);
    expect(store.entries.size).toBe(2);
  });

  it("does not double-persist a wamid already written by a Sales-OS-originated (Cloud API) send", async () => {
    const { deps, store, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    // Simulate sender.ts/markMessageSent already having written this exact
    // wamid as an OUTBOUND entry via the Cloud API send path.
    await deps.appendEntry!("conv-preexisting", {
      direction: "OUTBOUND",
      content: "Already sent via Sales OS",
      messageType: "TEXT",
      occurredAt: new Date(),
      externalId: "wamid.ECHO1",
    });
    recordDomainEvent.mockClear();

    const result = await gateway.handleBusinessAppEchoEvent(echoMessage({ externalId: "wamid.ECHO1" }));

    expect(result.duplicate).toBe(true);
    expect(store.entries.size).toBe(1);
    expect(recordDomainEvent).not.toHaveBeenCalled();
  });

  it("is idempotent for a redelivered echo of the same wamid", async () => {
    const { deps, store } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const first = await gateway.handleBusinessAppEchoEvent(echoMessage());
    const second = await gateway.handleBusinessAppEchoEvent(echoMessage());

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(store.entries.size).toBe(1);
  });

  it("records MESSAGE_SENT (not MESSAGE_RECEIVED) for a new echo", async () => {
    const { deps, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleBusinessAppEchoEvent(echoMessage());

    const eventTypes = recordDomainEvent.mock.calls.map((call) => call[0].event.type);
    expect(eventTypes).toEqual(["CONVERSATION_CREATED", "MESSAGE_SENT"]);
    expect(recordDomainEvent.mock.calls[1][0].event).toMatchObject({ conversationEntryId: result.entryId, content: "On my way" });
  });

  it("never triggers analysis for an echo — only inbound customer messages do", async () => {
    const { deps, runAnalysis } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    await gateway.handleBusinessAppEchoEvent(echoMessage());

    expect(runAnalysis).not.toHaveBeenCalled();
  });

  it("throws UnknownPhoneNumberError for a phoneNumberId that isn't registered to any business", async () => {
    const { deps } = createFakeGatewayDeps({ phoneNumbers: [] });
    const gateway = createWhatsAppGateway(deps);

    await expect(gateway.handleBusinessAppEchoEvent(echoMessage())).rejects.toBeInstanceOf(UnknownPhoneNumberError);
  });

  it.each(["EDIT", "REVOKE"] as const)("ignores a %s subtype without persisting anything or recording a domain event", async (subtype) => {
    const { deps, store, recordDomainEvent } = createFakeGatewayDeps({
      phoneNumbers: [{ id: "wpn-1", businessId: "biz-1", phoneNumberId: "phone-number-id-1" }],
    });
    const gateway = createWhatsAppGateway(deps);

    const result = await gateway.handleBusinessAppEchoEvent(echoMessage({ subtype }));

    expect(result).toEqual({ duplicate: false, ignored: true, observationsRecorded: false });
    expect(store.entries.size).toBe(0);
    expect(recordDomainEvent).not.toHaveBeenCalled();
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
