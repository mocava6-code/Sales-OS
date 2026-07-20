import { describe, expect, it } from "vitest";
import type { DecisionStatus } from "../../intelligence/decision/types";
import { assertOutcomeRecordable } from "../outcome-attribution-policy";
import { MissingOutcomeAttributionError, OutcomeNotAllowedForDecisionStatusError } from "../errors";

const TERMINAL_NON_EXECUTION_STATUSES: DecisionStatus[] = ["REJECTED", "OVERRIDDEN", "CANCELLED"];
const NORMAL_PROGRESSION_STATUSES: DecisionStatus[] = ["APPROVED", "EXECUTED"];

describe("assertOutcomeRecordable — terminal non-execution statuses", () => {
  for (const status of TERMINAL_NON_EXECUTION_STATUSES) {
    it(`rejects an unattributed outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "CUSTOMER_REPLIED", undefined)).toThrow(
        OutcomeNotAllowedForDecisionStatusError,
      );
    });

    it(`rejects a KORI_RECOMMENDATION-attributed outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "QUOTATION_SENT", "KORI_RECOMMENDATION")).toThrow(
        OutcomeNotAllowedForDecisionStatusError,
      );
    });

    it(`allows an ADVISOR_ALTERNATIVE-attributed outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "QUOTATION_SENT", "ADVISOR_ALTERNATIVE")).not.toThrow();
    });

    it(`allows an UNATTRIBUTED outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "CUSTOMER_REPLIED", "UNATTRIBUTED")).not.toThrow();
    });
  }
});

describe("assertOutcomeRecordable — normal progression statuses", () => {
  for (const status of NORMAL_PROGRESSION_STATUSES) {
    it(`allows an unattributed non-sale outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "CUSTOMER_REPLIED", undefined)).not.toThrow();
    });

    it(`allows a KORI_RECOMMENDATION-attributed outcome against a ${status} decision`, () => {
      expect(() => assertOutcomeRecordable(status, "QUOTATION_SENT", "KORI_RECOMMENDATION")).not.toThrow();
    });
  }
});

describe("assertOutcomeRecordable — SALE_CLOSED / SALE_LOST attribution requirement", () => {
  it("rejects SALE_CLOSED with no attribution, even against an EXECUTED decision", () => {
    expect(() => assertOutcomeRecordable("EXECUTED", "SALE_CLOSED", undefined)).toThrow(MissingOutcomeAttributionError);
  });

  it("rejects SALE_LOST with no attribution, even against an EXECUTED decision", () => {
    expect(() => assertOutcomeRecordable("EXECUTED", "SALE_LOST", undefined)).toThrow(MissingOutcomeAttributionError);
  });

  it("allows SALE_CLOSED with an explicit attribution against an EXECUTED decision", () => {
    expect(() => assertOutcomeRecordable("EXECUTED", "SALE_CLOSED", "KORI_RECOMMENDATION")).not.toThrow();
  });

  it("allows SALE_LOST with an explicit UNATTRIBUTED against an APPROVED decision", () => {
    expect(() => assertOutcomeRecordable("APPROVED", "SALE_LOST", "UNATTRIBUTED")).not.toThrow();
  });

  it("still requires non-KORI attribution for SALE_CLOSED against an OVERRIDDEN decision", () => {
    expect(() => assertOutcomeRecordable("OVERRIDDEN", "SALE_CLOSED", "KORI_RECOMMENDATION")).toThrow(
      OutcomeNotAllowedForDecisionStatusError,
    );
    expect(() => assertOutcomeRecordable("OVERRIDDEN", "SALE_CLOSED", "ADVISOR_ALTERNATIVE")).not.toThrow();
  });
});

describe("assertOutcomeRecordable — PROPOSED is left unrestricted", () => {
  it("allows any attribution (including none) against a PROPOSED decision for non-sale outcomes", () => {
    expect(() => assertOutcomeRecordable("PROPOSED", "CUSTOMER_REPLIED", undefined)).not.toThrow();
    expect(() => assertOutcomeRecordable("PROPOSED", "CUSTOMER_REPLIED", "KORI_RECOMMENDATION")).not.toThrow();
  });
});
