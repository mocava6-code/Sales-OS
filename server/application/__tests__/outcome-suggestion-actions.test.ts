import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

vi.mock("../access-control", () => ({ loadAuthorizedConversation: vi.fn() }));
vi.mock("../../kori/outcome-suggestion", () => ({ suggestConversationOutcome: vi.fn() }));

const { loadAuthorizedConversation } = await import("../access-control");
const { suggestConversationOutcome } = await import("../../kori/outcome-suggestion");
const { suggestConversationOutcomeHandler } = await import("../outcome-suggestion-actions");

const advisor = { id: "user-1", businessId: "biz-real-tenant", role: "SALESPERSON" as const };

function fakeConversation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "conv-1",
    businessId: "biz-real-tenant",
    channel: "WHATSAPP" as const,
    entries: [
      { direction: "INBOUND" as const, content: "Hola", occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "OUTBOUND" as const, content: "Hola, cómo te ayudo?", occurredAt: new Date("2026-08-01T10:01:00.000Z") },
    ],
    ...overrides,
  };
}

describe("suggestConversationOutcomeHandler — authentication", () => {
  it("returns UNAUTHENTICATED and never loads the conversation when there is no signed-in user", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    const resolver = createFakeAuthContextResolver(null);

    const result = await suggestConversationOutcomeHandler({ conversationId: "conv-1" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("UNAUTHENTICATED");
    expect(loadAuthorizedConversation).not.toHaveBeenCalled();
  });
});

describe("suggestConversationOutcomeHandler — input validation", () => {
  it("returns INVALID_INPUT for a missing conversationId", async () => {
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await suggestConversationOutcomeHandler({}, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});

describe("suggestConversationOutcomeHandler — tenant isolation", () => {
  it("returns NOT_FOUND for a cross-tenant conversation", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(loadAuthorizedConversation).mockRejectedValue(new NotFoundError("la conversación"));
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await suggestConversationOutcomeHandler({ conversationId: "conv-owned-by-another-business" }, { resolver });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NOT_FOUND");
  });
});

describe("suggestConversationOutcomeHandler — successful execution", () => {
  it("passes the last 15 entries in order to the suggestion service and returns its result", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(suggestConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(suggestConversationOutcome).mockResolvedValue({
      suggestedOutcomeType: "SALE_LOST",
      suggestedLostReason: "PRECIO",
      reasoning: "El cliente preguntó el precio y no volvió a responder.",
    });
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await suggestConversationOutcomeHandler({ conversationId: "conv-1" }, { resolver });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.suggestedOutcomeType).toBe("SALE_LOST");
    const call = vi.mocked(suggestConversationOutcome).mock.calls[0];
    expect(call[0]).toEqual([
      { direction: "INBOUND", content: "Hola", occurredAt: new Date("2026-08-01T10:00:00.000Z") },
      { direction: "OUTBOUND", content: "Hola, cómo te ayudo?", occurredAt: new Date("2026-08-01T10:01:00.000Z") },
    ]);
  });

  it("bounds the entries passed to the suggestion service to the most recent 15", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(suggestConversationOutcome).mockReset();
    const manyEntries = Array.from({ length: 20 }, (_, i) => ({
      direction: "INBOUND" as const,
      content: `msg-${i}`,
      occurredAt: new Date(2026, 7, 1, 10, i),
    }));
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation({ entries: manyEntries }));
    vi.mocked(suggestConversationOutcome).mockResolvedValue(null);
    const resolver = createFakeAuthContextResolver(advisor);

    await suggestConversationOutcomeHandler({ conversationId: "conv-1" }, { resolver });

    const call = vi.mocked(suggestConversationOutcome).mock.calls[0];
    expect(call[0]).toHaveLength(15);
    expect(call[0][0].content).toBe("msg-5");
    expect(call[0][14].content).toBe("msg-19");
  });

  it("returns data: null (not an error) when the suggestion service has no opinion", async () => {
    vi.mocked(loadAuthorizedConversation).mockReset();
    vi.mocked(suggestConversationOutcome).mockReset();
    vi.mocked(loadAuthorizedConversation).mockResolvedValue(fakeConversation());
    vi.mocked(suggestConversationOutcome).mockResolvedValue(null);
    const resolver = createFakeAuthContextResolver(advisor);

    const result = await suggestConversationOutcomeHandler({ conversationId: "conv-1" }, { resolver });

    expect(result).toEqual({ ok: true, data: null });
  });
});
