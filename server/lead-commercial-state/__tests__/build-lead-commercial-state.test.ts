import { describe, expect, it } from "vitest";
import { buildLeadCommercialState, type LeadForCommercialState } from "../build-lead-commercial-state";

/** The exact Sprint 7 worked example, shaped as getLead()'s Lead+conversations+entries structure. */
function workedExampleLead(): LeadForCommercialState {
  return {
    id: "lead-1",
    conversations: [
      {
        id: "conv-1",
        status: "WAITING_ON_CUSTOMER",
        lastEntryAt: new Date("2026-07-24T14:25:00Z"),
        lastEntryDirection: "OUTBOUND",
        entries: [
          { id: "m1", direction: "INBOUND", content: "tiene kit de hilux travo 2026?", occurredAt: new Date("2026-07-24T14:00:00Z") },
          { id: "m2", direction: "OUTBOUND", content: "si, los desea?", occurredAt: new Date("2026-07-24T14:05:00Z") },
          { id: "m3", direction: "INBOUND", content: "hace envíos a chaclacayo?", occurredAt: new Date("2026-07-24T14:10:00Z") },
          { id: "m4", direction: "OUTBOUND", content: "si, para cuando lo desea?", occurredAt: new Date("2026-07-24T14:15:00Z") },
          { id: "m5", direction: "INBOUND", content: "para manana a las 12", occurredAt: new Date("2026-07-24T14:20:00Z") },
          { id: "m6", direction: "OUTBOUND", content: "ok aqui le paso el numero de cuenta para que realice el pago", occurredAt: new Date("2026-07-24T14:25:00Z") },
        ],
      },
    ],
  };
}

describe("buildLeadCommercialState — worked example, through the read-model layer", () => {
  it("produces a fully-populated, JSON-safe DTO matching the Sprint 7 spec", () => {
    const dto = buildLeadCommercialState(workedExampleLead(), "America/Lima");

    // Kori Data Correctness Phase 1C — brand/model/year/product are now
    // separate fields instead of one compound vehicleModel string.
    expect(dto.productInterest.value).toBe("TRAVO kit");
    expect(dto.vehicleModel.value).toBe("Hilux");
    expect(dto.vehicleBrand.value).toBe("Toyota");
    expect(dto.vehicleYear.value).toBe(2026);
    expect(dto.deliveryLocation.value).toBe("Chaclacayo");
    expect(dto.requestedDeliveryAt.value).toBe("2026-07-25T17:00:00.000Z");
    expect(dto.paymentStatus.value).toBe("AWAITING_PAYMENT");
    expect(dto.lastContactDirection).toBe("OUTBOUND");
    expect(dto.conversationState).toBe("WAITING_ON_CUSTOMER");
    expect(dto.nextAction.value).toBe("CONFIRM_PAYMENT");
    expect(dto.followUpDueAt.value).toBe("2026-07-24T18:25:00.000Z");
    expect(dto.activeConversationId).toBe("conv-1");

    // Every value is JSON-safe (no Date/class instances leaked into the DTO).
    expect(() => JSON.stringify(dto)).not.toThrow();
    expect(typeof dto.lastContactAt).toBe("string");
  });

  it("carries confidence and evidence excerpts for the display affordance", () => {
    const dto = buildLeadCommercialState(workedExampleLead(), "America/Lima");

    expect(dto.productInterest.confidence).toBeGreaterThan(0);
    expect(dto.productInterest.evidenceExcerpt).toContain("hilux");
    expect(dto.nextAction.reasoning).toMatch(/payment/i);
  });

  it("uses the business's configured timezone, not a hardcoded one", () => {
    const nyDto = buildLeadCommercialState(workedExampleLead(), "America/New_York");
    // Same wall-clock expression ("mañana a las 12"), different timezone -> different UTC instant.
    expect(nyDto.requestedDeliveryAt.value).not.toBe("2026-07-25T17:00:00.000Z");
  });
});
