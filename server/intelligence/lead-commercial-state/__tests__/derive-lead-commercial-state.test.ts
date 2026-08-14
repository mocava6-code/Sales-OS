import { describe, expect, it } from "vitest";
import { deriveLeadCommercialState, type LeadCommercialStateDependencies } from "../derive-lead-commercial-state";
import { customerTypeExtractor } from "../extractors/customer-type-extractor";
import { createRequestedDeliveryAtExtractor } from "../extractors/relative-date-extractor";
import { productInterestExtractor, vehicleBrandExtractor, vehicleModelExtractor, vehicleYearExtractor } from "../extractors/freetext-product-extractor";
import { deliveryLocationExtractor } from "../extractors/location-extractor";
import { paymentStatusExtractor } from "../extractors/payment-extractor";
import type { ConversationSummaryForActiveResolution, NormalizedMessageForExtraction } from "../types";

const LIMA = "America/Lima";

function buildDependencies(): LeadCommercialStateDependencies {
  return {
    productInterestExtractors: [productInterestExtractor],
    vehicleModelExtractors: [vehicleModelExtractor],
    vehicleBrandExtractors: [vehicleBrandExtractor],
    vehicleYearExtractors: [vehicleYearExtractor],
    locationExtractors: [deliveryLocationExtractor],
    dateExtractors: [createRequestedDeliveryAtExtractor(LIMA)],
    paymentExtractors: [paymentStatusExtractor],
    customerTypeExtractors: [customerTypeExtractor],
  };
}

/**
 * The exact worked-example conversation from the Sprint 7 spec:
 *
 *   Customer: tiene kit de hilux travo 2026?
 *   Advisor:  si, los desea?
 *   Customer: hace envíos a chaclacayo?
 *   Advisor:  si, para cuando lo desea?
 *   Customer: para manana a las 12
 *   Advisor:  ok aqui le paso el numero de cuenta para que realice el pago
 */
function workedExampleMessages(): NormalizedMessageForExtraction[] {
  return [
    { id: "m1", conversationId: "conv-1", direction: "INBOUND", content: "tiene kit de hilux travo 2026?", occurredAt: new Date("2026-07-24T14:00:00Z") },
    { id: "m2", conversationId: "conv-1", direction: "OUTBOUND", content: "si, los desea?", occurredAt: new Date("2026-07-24T14:05:00Z") },
    { id: "m3", conversationId: "conv-1", direction: "INBOUND", content: "hace envíos a chaclacayo?", occurredAt: new Date("2026-07-24T14:10:00Z") },
    { id: "m4", conversationId: "conv-1", direction: "OUTBOUND", content: "si, para cuando lo desea?", occurredAt: new Date("2026-07-24T14:15:00Z") },
    { id: "m5", conversationId: "conv-1", direction: "INBOUND", content: "para manana a las 12", occurredAt: new Date("2026-07-24T14:20:00Z") },
    { id: "m6", conversationId: "conv-1", direction: "OUTBOUND", content: "ok aqui le paso el numero de cuenta para que realice el pago", occurredAt: new Date("2026-07-24T14:25:00Z") },
  ];
}

function workedExampleConversations(): ConversationSummaryForActiveResolution[] {
  return [
    { id: "conv-1", status: "WAITING_ON_CUSTOMER", lastEntryAt: new Date("2026-07-24T14:25:00Z"), lastEntryDirection: "OUTBOUND" },
  ];
}

describe("deriveLeadCommercialState — worked example, end to end", () => {
  it("produces every field exactly as specified in the Sprint 7 spec", () => {
    const state = deriveLeadCommercialState("lead-1", workedExampleMessages(), workedExampleConversations(), buildDependencies());

    // Kori Data Correctness Phase 1C — vehicleModel/productInterest no
    // longer carry the compound "Hilux TRAVO 2026" string; brand/model/year
    // are now separated, with productInterest holding just the product line.
    expect(state.productInterest.value).toBe("TRAVO kit");
    expect(state.vehicleModel.value).toBe("Hilux");
    expect(state.vehicleBrand.value).toBe("Toyota");
    expect(state.vehicleYear.value).toBe(2026);
    expect(state.deliveryLocation.value).toBe("Chaclacayo");
    expect(state.requestedDeliveryAt.value?.toISOString()).toBe("2026-07-25T17:00:00.000Z"); // tomorrow noon, Lima -> UTC
    expect(state.paymentStatus.value).toBe("AWAITING_PAYMENT");
    expect(state.lastContactDirection.value).toBe("OUTBOUND");
    expect(state.conversationState.value).toBe("WAITING_ON_CUSTOMER");
    expect(state.nextAction.value).toBe("CONFIRM_PAYMENT");
    expect(state.followUpDueAt.value?.toISOString()).toBe("2026-07-24T18:25:00.000Z"); // last OUTBOUND contact + 4h default SLA
    expect(state.metadata.activeConversationId).toBe("conv-1");
  });

  it("every mutable field carries evidence pointing back to the message that produced it", () => {
    const state = deriveLeadCommercialState("lead-1", workedExampleMessages(), workedExampleConversations(), buildDependencies());

    expect(state.productInterest.evidence[0].sourceId).toBe("m1");
    expect(state.deliveryLocation.evidence[0].sourceId).toBe("m3");
    expect(state.requestedDeliveryAt.evidence[0].sourceId).toBe("m5");
    expect(state.paymentStatus.evidence[0].sourceId).toBe("m6");
  });

  it("distinguishes facts from inferences per the engine's contract", () => {
    const state = deriveLeadCommercialState("lead-1", workedExampleMessages(), workedExampleConversations(), buildDependencies());

    expect(state.productInterest.kind).toBe("fact");
    expect(state.conversationState.kind).toBe("fact");
    expect(state.paymentStatus.kind).toBe("inference");
    expect(state.nextAction.kind).toBe("inference");
    expect(state.followUpDueAt.kind).toBe("inference");
  });

  it("throws NoConversationsForLeadError for a lead with zero conversations", async () => {
    const { NoConversationsForLeadError } = await import("../errors");
    expect(() => deriveLeadCommercialState("lead-empty", [], [], buildDependencies())).toThrow(NoConversationsForLeadError);
  });
});

describe("deriveLeadCommercialState — multi-conversation precedence", () => {
  it("prefers the active conversation's product interest over a stale historical one, end to end", () => {
    const historicalMessages: NormalizedMessageForExtraction[] = [
      { id: "h1", conversationId: "conv-old", direction: "INBOUND", content: "tiene kit para fortuner 2020?", occurredAt: new Date("2026-06-01T12:00:00Z") },
      { id: "h2", conversationId: "conv-old", direction: "OUTBOUND", content: "si tenemos", occurredAt: new Date("2026-06-01T12:05:00Z") },
    ];
    const conversations: ConversationSummaryForActiveResolution[] = [
      { id: "conv-old", status: "CLOSED", lastEntryAt: new Date("2026-06-01T12:05:00Z"), lastEntryDirection: "OUTBOUND" },
      { id: "conv-1", status: "WAITING_ON_CUSTOMER", lastEntryAt: new Date("2026-07-24T14:25:00Z"), lastEntryDirection: "OUTBOUND" },
    ];

    const state = deriveLeadCommercialState(
      "lead-1",
      [...historicalMessages, ...workedExampleMessages()],
      conversations,
      buildDependencies(),
    );

    expect(state.productInterest.value).toBe("TRAVO kit");
    expect(state.metadata.activeConversationId).toBe("conv-1");
  });
});

describe("deriveLeadCommercialState — cross-conversation commercial contamination (production regression, lead 9b64e8a2)", () => {
  // Reproduces the EXACT mechanism found in production: a MANUAL_ENTRY
  // conversation contains an old test commercial exchange (payment
  // requested for a "Hilux TRAVO 2026" kit), then later receives
  // unrelated, non-commercial personal messages that bump its
  // lastEntryAt ahead of a separate, genuinely active WhatsApp
  // conversation carrying a real, distinct customer inquiry (Hilux 2022,
  // never mentions payment). Before the fix, resolveActiveConversation's
  // raw last-entry recency made the stale conversation win "active"
  // status, so its dormant AWAITING_PAYMENT and wrong vehicleYear (2026)
  // silently became the lead's current commercial state.
  function manualEntryConversationMessages(): NormalizedMessageForExtraction[] {
    return [
      { id: "me1", conversationId: "conv-manual", direction: "INBOUND", content: "tienes kit de hilux travo 2026?", occurredAt: new Date("2026-07-24T22:24:50.940Z") },
      { id: "me2", conversationId: "conv-manual", direction: "OUTBOUND", content: "si, los desea?", occurredAt: new Date("2026-07-24T22:24:50.941Z") },
      { id: "me3", conversationId: "conv-manual", direction: "OUTBOUND", content: "ok aqui le paso el numero de cuenta para que realice el pago", occurredAt: new Date("2026-07-24T22:24:50.945Z") },
      // Later, unrelated personal chatter — no commercial content, but
      // it's the newest activity on the lead by raw timestamp.
      { id: "me4", conversationId: "conv-manual", direction: "INBOUND", content: "Marii, elige", occurredAt: new Date("2026-08-12T17:18:31.000Z") },
      { id: "me5", conversationId: "conv-manual", direction: "INBOUND", content: "Ponte la camiseta y elige que almorzar!!", occurredAt: new Date("2026-08-12T17:26:46.000Z") },
      { id: "me6", conversationId: "conv-manual", direction: "INBOUND", content: "no hacer caso", occurredAt: new Date("2026-08-12T19:36:34.000Z") },
    ];
  }

  function whatsappConversationMessages(): NormalizedMessageForExtraction[] {
    return [
      { id: "w1", conversationId: "conv-whatsapp", direction: "INBOUND", content: "Hola, tengo una Toyota Hilux 2022 y quiero comprar el body kit TRAVO. ¿Cuánto cuesta?", occurredAt: new Date("2026-08-11T13:48:17.000Z") },
    ];
  }

  function contaminationConversations(): ConversationSummaryForActiveResolution[] {
    return [
      { id: "conv-manual", status: "NEEDS_REPLY", lastEntryAt: new Date("2026-08-12T19:36:34.000Z"), lastEntryDirection: "INBOUND" },
      { id: "conv-whatsapp", status: "NEEDS_REPLY", lastEntryAt: new Date("2026-08-11T13:48:17.000Z"), lastEntryDirection: "INBOUND" },
    ];
  }

  it("scopes mutable commercial fields to the conversation with the freshest commercial evidence, not the freshest entry of any kind", () => {
    const state = deriveLeadCommercialState(
      "lead-9b64e8a2",
      [...manualEntryConversationMessages(), ...whatsappConversationMessages()],
      contaminationConversations(),
      buildDependencies(),
    );

    expect(state.vehicleModel.value).toBe("Hilux");
    expect(state.vehicleYear.value).toBe(2022); // the real customer's stated year, not the stale "travo 2026" test text
    expect(state.metadata.commercialContextConversationId).toBe("conv-whatsapp");
  });

  it("does not resurrect a dormant historical payment request onto an unrelated, currently-active inquiry", () => {
    const state = deriveLeadCommercialState(
      "lead-9b64e8a2",
      [...manualEntryConversationMessages(), ...whatsappConversationMessages()],
      contaminationConversations(),
      buildDependencies(),
    );

    expect(state.paymentStatus.value).toBeNull();
    expect(state.nextAction.value).not.toBe("CONFIRM_PAYMENT");
  });

  it("still reports the raw active conversation (for lastContactAt/conversationState) as the most recently touched one, independent of commercial context", () => {
    const state = deriveLeadCommercialState(
      "lead-9b64e8a2",
      [...manualEntryConversationMessages(), ...whatsappConversationMessages()],
      contaminationConversations(),
      buildDependencies(),
    );

    expect(state.metadata.activeConversationId).toBe("conv-manual");
    expect(state.lastContactDirection.value).toBe("INBOUND");
  });
});
