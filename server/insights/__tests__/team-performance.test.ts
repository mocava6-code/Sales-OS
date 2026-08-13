import { describe, expect, it } from "vitest";
import { deriveTeamPerformance } from "../team-performance";

describe("deriveTeamPerformance", () => {
  it("computes per-advisor conversationsHandled, avgResponseTimeMinutes, and conversionRate", () => {
    const { advisors } = deriveTeamPerformance(
      [
        { advisorUserId: "u1", advisorName: "María", responseMinutes: 10 },
        { advisorUserId: "u1", advisorName: "María", responseMinutes: 20 },
      ],
      [
        { advisorUserId: "u1", outcomeType: "SALE_CLOSED" },
        { advisorUserId: "u1", outcomeType: "SALE_LOST" },
      ],
    );

    expect(advisors).toEqual([
      { advisorUserId: "u1", advisorName: "María", conversationsHandled: 2, avgResponseTimeMinutes: 15, decided: 2, closed: 1, conversionRate: 0.5, highlight: null },
    ]);
  });

  it("computes a team average across every advisor combined", () => {
    const { teamAverage } = deriveTeamPerformance(
      [
        { advisorUserId: "u1", advisorName: "María", responseMinutes: 10 },
        { advisorUserId: "u2", advisorName: "Juan", responseMinutes: 30 },
      ],
      [
        { advisorUserId: "u1", outcomeType: "SALE_CLOSED" },
        { advisorUserId: "u2", outcomeType: "SALE_LOST" },
      ],
    );

    expect(teamAverage).toEqual({ avgResponseTimeMinutes: 20, conversionRate: 0.5 });
  });

  it("includes an advisor who has outcomes but no conversation rows this period", () => {
    const { advisors } = deriveTeamPerformance([], [{ advisorUserId: "u1", outcomeType: "SALE_CLOSED" }]);
    expect(advisors).toHaveLength(1);
    expect(advisors[0]).toMatchObject({ advisorUserId: "u1", advisorName: "Sin nombre", decided: 1, closed: 1 });
  });

  it("never mentions one advisor by name relative to another — only ever vs. the team average", () => {
    const { advisors } = deriveTeamPerformance(
      [
        { advisorUserId: "fast", advisorName: "María", responseMinutes: 5 },
        { advisorUserId: "slow", advisorName: "Juan", responseMinutes: 100 },
      ],
      [
        { advisorUserId: "fast", outcomeType: "SALE_CLOSED" },
        { advisorUserId: "fast", outcomeType: "SALE_CLOSED" },
        { advisorUserId: "slow", outcomeType: "SALE_LOST" },
        { advisorUserId: "slow", outcomeType: "SALE_LOST" },
      ],
    );

    for (const advisor of advisors) {
      if (advisor.highlight) {
        const otherAdvisorName = advisor.advisorName === "María" ? "Juan" : "María";
        expect(advisor.highlight).not.toContain(otherAdvisorName);
        expect(advisor.highlight.startsWith(advisor.advisorName)).toBe(true);
      }
    }
  });

  describe("highlight", () => {
    it("stays null when an advisor has too few decided outcomes", () => {
      const { advisors } = deriveTeamPerformance(
        [{ advisorUserId: "u1", advisorName: "María", responseMinutes: 5 }],
        [{ advisorUserId: "u1", outcomeType: "SALE_CLOSED" }],
      );
      expect(advisors[0].highlight).toBeNull();
    });

    it("highlights an advisor who is notably faster AND converts better than the team average", () => {
      const { advisors } = deriveTeamPerformance(
        [
          { advisorUserId: "fast", advisorName: "María", responseMinutes: 8 },
          { advisorUserId: "fast", advisorName: "María", responseMinutes: 8 },
          { advisorUserId: "slow", advisorName: "Juan", responseMinutes: 40 },
          { advisorUserId: "slow", advisorName: "Juan", responseMinutes: 40 },
        ],
        [
          { advisorUserId: "fast", outcomeType: "SALE_CLOSED" },
          { advisorUserId: "fast", outcomeType: "SALE_CLOSED" },
          { advisorUserId: "slow", outcomeType: "SALE_LOST" },
          { advisorUserId: "slow", outcomeType: "SALE_LOST" },
        ],
      );

      const maria = advisors.find((a) => a.advisorUserId === "fast")!;
      expect(maria.highlight).toBe("María responde 67% más rápido que el promedio del equipo, y convierte mejor.");
    });

    it("highlights conversion alone when speed isn't notably better", () => {
      const { advisors } = deriveTeamPerformance(
        [
          { advisorUserId: "u1", advisorName: "María", responseMinutes: 20 },
          { advisorUserId: "u2", advisorName: "Juan", responseMinutes: 20 },
        ],
        [
          { advisorUserId: "u1", outcomeType: "SALE_CLOSED" },
          { advisorUserId: "u1", outcomeType: "SALE_CLOSED" },
          { advisorUserId: "u2", outcomeType: "SALE_LOST" },
          { advisorUserId: "u2", outcomeType: "SALE_LOST" },
        ],
      );

      const maria = advisors.find((a) => a.advisorUserId === "u1")!;
      expect(maria.highlight).toBe("María convierte 50 puntos porcentuales más que el promedio del equipo.");
    });

    it("returns null when an advisor is at or below the team average on both dimensions", () => {
      const { advisors } = deriveTeamPerformance(
        [
          { advisorUserId: "u1", advisorName: "María", responseMinutes: 20 },
          { advisorUserId: "u2", advisorName: "Juan", responseMinutes: 20 },
        ],
        [
          { advisorUserId: "u1", outcomeType: "SALE_LOST" },
          { advisorUserId: "u1", outcomeType: "SALE_LOST" },
          { advisorUserId: "u2", outcomeType: "SALE_CLOSED" },
          { advisorUserId: "u2", outcomeType: "SALE_CLOSED" },
        ],
      );

      const maria = advisors.find((a) => a.advisorUserId === "u1")!;
      expect(maria.highlight).toBeNull();
    });
  });
});
