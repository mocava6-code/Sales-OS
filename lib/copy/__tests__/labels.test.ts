// Spanish-language product pass — proves the canonical label maps stay in
// sync with their source enums (a new Prisma enum value with no Spanish
// label is a silent raw-enum leak waiting to happen) and never accidentally
// regress to English or to "Desconocido" for missing data.
import { describe, expect, it } from "vitest";
import { ConversationStatus, LeadPriority, LeadStatus, UserRole } from "@/server/db/generated/enums";
import { ACTION_REASON_CODES } from "@/server/intelligence/response-action/reason-codes";
import {
  CONVERSATION_STATUS_LABELS,
  CUSTOMER_TYPE_LABELS,
  LEAD_PRIORITY_LABELS,
  LEAD_STATUS_LABELS,
  UNKNOWN_LABEL,
  USER_ROLE_LABELS,
} from "../labels";

describe("lib/copy/labels — completeness against source enums", () => {
  it("has a Spanish label for every LeadStatus value", () => {
    for (const value of Object.values(LeadStatus)) {
      expect(LEAD_STATUS_LABELS[value]).toBeTruthy();
    }
  });

  it("has a Spanish label for every LeadPriority value", () => {
    for (const value of Object.values(LeadPriority)) {
      expect(LEAD_PRIORITY_LABELS[value]).toBeTruthy();
    }
  });

  it("has a Spanish label for every ConversationStatus value", () => {
    for (const value of Object.values(ConversationStatus)) {
      expect(CONVERSATION_STATUS_LABELS[value]).toBeTruthy();
    }
  });

  it("has a Spanish label for every UserRole value", () => {
    for (const value of Object.values(UserRole)) {
      expect(USER_ROLE_LABELS[value]).toBeTruthy();
    }
  });
});

describe("lib/copy/labels — no raw internal value ever equals its own label", () => {
  it.each([
    ["LEAD_STATUS_LABELS", LEAD_STATUS_LABELS],
    ["LEAD_PRIORITY_LABELS", LEAD_PRIORITY_LABELS],
    ["CONVERSATION_STATUS_LABELS", CONVERSATION_STATUS_LABELS],
    ["CUSTOMER_TYPE_LABELS", CUSTOMER_TYPE_LABELS],
    ["USER_ROLE_LABELS", USER_ROLE_LABELS],
  ] as const)("%s never echoes the raw key back unchanged", (_name, map) => {
    for (const [key, label] of Object.entries(map)) {
      expect(label).not.toBe(key);
    }
  });
});

describe("lib/copy/labels — missing-data convention", () => {
  it("renders unknown customer type as 'Sin información', never 'Desconocido'", () => {
    expect(CUSTOMER_TYPE_LABELS.UNKNOWN).toBe("Sin información");
    expect(UNKNOWN_LABEL).toBe("Sin información");
    expect(CUSTOMER_TYPE_LABELS.UNKNOWN.toLowerCase()).not.toContain("desconocido");
  });
});

describe("ACTION_REASON_CODE_LABELS — every taxonomy code covered (imported for cross-check)", () => {
  it("keeps the reason-code taxonomy and its label map in lockstep", async () => {
    const { ACTION_REASON_CODE_LABELS } = await import("@/server/intelligence/response-action/reason-codes");
    for (const code of ACTION_REASON_CODES) {
      expect(ACTION_REASON_CODE_LABELS[code]).toBeTruthy();
      expect(ACTION_REASON_CODE_LABELS[code]).not.toBe(code);
    }
  });
});
