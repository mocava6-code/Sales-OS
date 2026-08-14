import { describe, expect, it } from "vitest";
import { InvalidKoriQuerySpecError } from "../errors";
import { KORI_QUERY_DEFAULT_LIMIT, KORI_QUERY_MAX_LIMIT, parseKoriQuerySpec } from "../query-spec";

describe("parseKoriQuerySpec", () => {
  it("parses a minimal valid spec and defaults limit", () => {
    const spec = parseKoriQuerySpec({ operation: "COUNT_LEADS" });
    expect(spec.operation).toBe("COUNT_LEADS");
    expect(spec.limit).toBe(KORI_QUERY_DEFAULT_LIMIT);
  });

  it("parses a full spec with filters/sort/limit", () => {
    const spec = parseKoriQuerySpec({
      operation: "LIST_LEADS",
      filters: { vehicleBrand: "Toyota", needsReply: true },
      sort: { field: "createdAt", direction: "desc" },
      limit: 10,
    });
    expect(spec.filters?.vehicleBrand).toBe("Toyota");
    expect(spec.limit).toBe(10);
  });

  it("rejects an unknown operation", () => {
    expect(() => parseKoriQuerySpec({ operation: "DELETE_LEADS" })).toThrow(InvalidKoriQuerySpecError);
  });

  it("accepts a valid reasonCode filter, composed with actionState", () => {
    const spec = parseKoriQuerySpec({
      operation: "LIST_LEADS",
      filters: { actionState: "FOLLOW_UP_REQUIRED", reasonCode: "ADVISOR_COMMITMENT_PENDING" },
    });
    expect(spec.filters?.reasonCode).toBe("ADVISOR_COMMITMENT_PENDING");
    expect(spec.filters?.actionState).toBe("FOLLOW_UP_REQUIRED");
  });

  it("rejects a reasonCode value outside the bounded taxonomy", () => {
    expect(() => parseKoriQuerySpec({ operation: "LIST_LEADS", filters: { reasonCode: "NOT_A_REAL_REASON" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("accepts a valid observationType filter (business intelligence mission)", () => {
    const spec = parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { observationType: "QUOTE_REQUEST" } });
    expect(spec.filters?.observationType).toBe("QUOTE_REQUEST");
  });

  it("rejects an observationType value outside the bounded taxonomy (e.g. CUSTOMER_GHOSTED, deliberately excluded)", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { observationType: "CUSTOMER_GHOSTED" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects a smuggled businessId key at the top level", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", businessId: "biz-1" })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects a smuggled businessId key inside filters", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { businessId: "biz-1" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects an unknown filter key", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { quotedAmount: 500 } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("requires groupBy for GROUP_LEADS", () => {
    expect(() => parseKoriQuerySpec({ operation: "GROUP_LEADS" })).toThrow(InvalidKoriQuerySpecError);
  });

  it("accepts GROUP_LEADS with groupBy", () => {
    const spec = parseKoriQuerySpec({ operation: "GROUP_LEADS", groupBy: "vehicleBrand" });
    expect(spec.groupBy).toBe("vehicleBrand");
  });

  it("rejects groupBy on an operation other than GROUP_LEADS", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", groupBy: "vehicleBrand" })).toThrow(InvalidKoriQuerySpecError);
    expect(() => parseKoriQuerySpec({ operation: "PRODUCT_RANKING", groupBy: "vehicleBrand" })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects an invalid leadStatus/priority/outcomeType/customerType enum value", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { leadStatus: "ARCHIVED" } })).toThrow(InvalidKoriQuerySpecError);
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { priority: "URGENT" } })).toThrow(InvalidKoriQuerySpecError);
    expect(() => parseKoriQuerySpec({ operation: "COUNT_OUTCOMES", filters: { outcomeType: "REFUNDED" } })).toThrow(InvalidKoriQuerySpecError);
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { customerType: "GOVERNMENT" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects customerType=UNKNOWN as a filter value (deliberately excluded this phase)", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { customerType: "UNKNOWN" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("clamps/rejects limit outside [1,100]", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", limit: 0 })).toThrow(InvalidKoriQuerySpecError);
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", limit: 101 })).toThrow(InvalidKoriQuerySpecError);
    const spec = parseKoriQuerySpec({ operation: "COUNT_LEADS", limit: KORI_QUERY_MAX_LIMIT });
    expect(spec.limit).toBe(KORI_QUERY_MAX_LIMIT);
  });

  it("rejects createdFrom after createdTo", () => {
    expect(() =>
      parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { createdFrom: "2026-08-10", createdTo: "2026-08-01" } }),
    ).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects lastActivityAfter after lastActivityBefore", () => {
    expect(() =>
      parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { lastActivityAfter: "2026-08-10", lastActivityBefore: "2026-08-01" } }),
    ).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects a non-ISO date string", () => {
    expect(() => parseKoriQuerySpec({ operation: "COUNT_LEADS", filters: { createdFrom: "not-a-date" } })).toThrow(InvalidKoriQuerySpecError);
  });

  it("rejects an unknown sort field", () => {
    expect(() => parseKoriQuerySpec({ operation: "LIST_LEADS", sort: { field: "quotedAmount", direction: "asc" } })).toThrow(
      InvalidKoriQuerySpecError,
    );
  });
});
