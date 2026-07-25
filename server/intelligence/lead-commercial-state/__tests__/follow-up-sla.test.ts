import { describe, expect, it } from "vitest";
import { resolveFollowUpDueAt } from "../follow-up-sla";

describe("resolveFollowUpDueAt", () => {
  it("is modeled as an Inference, not a Fact", () => {
    const result = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "CONFIRM_PAYMENT", "conv-1", {});
    expect(result.kind).toBe("inference");
  });

  it("applies the default CONFIRM_PAYMENT SLA (4h) to the last contact time", () => {
    const result = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "CONFIRM_PAYMENT", "conv-1", {});
    expect(result.value?.toISOString()).toBe("2026-07-25T00:00:00.000Z");
  });

  it("names both the SLA and the base timestamp in its reasoning", () => {
    const result = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "CONFIRM_PAYMENT", "conv-1", {});
    expect(result.reasoning).toContain("4h");
    expect(result.reasoning).toContain("2026-07-24T20:00:00.000Z");
  });

  it("respects a caller-supplied SLA override", () => {
    const result = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "CONFIRM_PAYMENT", "conv-1", { CONFIRM_PAYMENT: 1 });
    expect(result.value?.toISOString()).toBe("2026-07-24T21:00:00.000Z");
    expect(result.reasoning).toContain("1h");
  });

  it("uses a different default SLA per next action", () => {
    const followUp = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "FOLLOW_UP", "conv-1", {});
    const answerQuestion = resolveFollowUpDueAt(new Date("2026-07-24T20:00:00Z"), "ANSWER_QUESTION", "conv-1", {});

    expect(followUp.value?.toISOString()).toBe("2026-07-25T20:00:00.000Z"); // 24h
    expect(answerQuestion.value?.toISOString()).toBe("2026-07-24T22:00:00.000Z"); // 2h
  });
});
