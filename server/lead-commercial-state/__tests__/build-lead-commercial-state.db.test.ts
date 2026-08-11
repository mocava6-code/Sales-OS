// Gated: proves getLead()'s real Prisma shape (server/services/lead-service.ts)
// flows correctly through buildLeadCommercialState — the only test in this
// suite that touches a real database, against sales_os_test only.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getLead } from "../../services/lead-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";
import { buildLeadCommercialState } from "../build-lead-commercial-state";

describe.skipIf(!shouldRunDbTests)("buildLeadCommercialState via getLead() (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "lead-commercial-state");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("resolves the worked example end to end through a real getLead() query", async () => {
    await db!.conversation.update({
      where: { id: fixture.conversationId },
      data: {
        status: "WAITING_ON_CUSTOMER",
        lastEntryAt: new Date("2026-07-24T14:25:00Z"),
        lastEntryDirection: "OUTBOUND",
      },
    });

    const entries = [
      { direction: "INBOUND" as const, content: "tiene kit de hilux travo 2026?", occurredAt: new Date("2026-07-24T14:00:00Z") },
      { direction: "OUTBOUND" as const, content: "si, los desea?", occurredAt: new Date("2026-07-24T14:05:00Z") },
      { direction: "INBOUND" as const, content: "hace envíos a chaclacayo?", occurredAt: new Date("2026-07-24T14:10:00Z") },
      { direction: "OUTBOUND" as const, content: "si, para cuando lo desea?", occurredAt: new Date("2026-07-24T14:15:00Z") },
      { direction: "INBOUND" as const, content: "para manana a las 12", occurredAt: new Date("2026-07-24T14:20:00Z") },
      { direction: "OUTBOUND" as const, content: "ok aqui le paso el numero de cuenta para que realice el pago", occurredAt: new Date("2026-07-24T14:25:00Z") },
    ];
    for (const entry of entries) {
      await db!.conversationEntry.create({ data: { conversationId: fixture.conversationId, ...entry } });
    }

    const lead = await getLead(fixture.businessId, fixture.leadId, db!);
    expect(lead).not.toBeNull();
    expect(lead!.business.timezone).toBe("America/Lima"); // schema default, confirmed selected

    const dto = buildLeadCommercialState(lead!, lead!.business.timezone);

    // Kori Data Correctness Phase 1C — brand/model/year/product are now
    // separate fields instead of one compound vehicleModel string.
    expect(dto.productInterest.value).toBe("TRAVO kit");
    expect(dto.vehicleModel.value).toBe("Hilux");
    expect(dto.vehicleBrand.value).toBe("Toyota");
    expect(dto.vehicleYear.value).toBe(2026);
    expect(dto.deliveryLocation.value).toBe("Chaclacayo");
    expect(dto.requestedDeliveryAt.value).toBe("2026-07-25T17:00:00.000Z");
    expect(dto.paymentStatus.value).toBe("AWAITING_PAYMENT");
    expect(dto.nextAction.value).toBe("CONFIRM_PAYMENT");
    expect(dto.activeConversationId).toBe(fixture.conversationId);
  });
});
