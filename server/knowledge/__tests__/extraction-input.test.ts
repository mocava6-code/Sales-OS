import { describe, expect, it } from "vitest";
import {
  fromConversationEntries,
  fromImportedMessages,
  fromWebsitePageSections,
  type ConversationEntryForExtraction,
  type ImportedMessageForExtraction,
} from "../extraction-input";

describe("fromImportedMessages", () => {
  function message(overrides: Partial<ImportedMessageForExtraction> = {}): ImportedMessageForExtraction {
    return {
      id: "msg-1",
      resolvedRole: "CUSTOMER",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
      content: "Hola",
      sequenceIndex: 0,
      ...overrides,
    };
  }

  it("maps ImportedMessageRole to ExtractionMessageRole and sets IMPORTED_MESSAGE provenance", () => {
    const [result] = fromImportedMessages([message({ resolvedRole: "BUSINESS" })]);

    expect(result).toMatchObject({
      id: "msg-1",
      role: "BUSINESS",
      content: "Hola",
      evidenceRefType: "IMPORTED_MESSAGE",
      evidenceRefId: "msg-1",
    });
  });

  it("preserves a null occurredAt rather than fabricating a date", () => {
    const [result] = fromImportedMessages([message({ occurredAt: null })]);

    expect(result.occurredAt).toBeNull();
  });

  it("orders by sequenceIndex, not occurredAt", () => {
    const results = fromImportedMessages([
      message({ id: "second", sequenceIndex: 1, occurredAt: null }),
      message({ id: "first", sequenceIndex: 0, occurredAt: null }),
    ]);

    expect(results.map((r) => r.id)).toEqual(["first", "second"]);
  });

  it("maps UNKNOWN role through without guessing BUSINESS or CUSTOMER", () => {
    const [result] = fromImportedMessages([message({ resolvedRole: "UNKNOWN" })]);

    expect(result.role).toBe("UNKNOWN");
  });
});

describe("fromConversationEntries", () => {
  function entry(overrides: Partial<ConversationEntryForExtraction> = {}): ConversationEntryForExtraction {
    return {
      id: "entry-1",
      direction: "INBOUND",
      content: "Hola",
      occurredAt: new Date("2026-07-20T12:00:00.000Z"),
      ...overrides,
    };
  }

  it("maps INBOUND to CUSTOMER and OUTBOUND to BUSINESS", () => {
    const [inbound] = fromConversationEntries([entry({ direction: "INBOUND" })]);
    const [outbound] = fromConversationEntries([entry({ direction: "OUTBOUND" })]);

    expect(inbound.role).toBe("CUSTOMER");
    expect(outbound.role).toBe("BUSINESS");
  });

  it("sets CONVERSATION_ENTRY provenance", () => {
    const [result] = fromConversationEntries([entry({ id: "entry-42" })]);

    expect(result.evidenceRefType).toBe("CONVERSATION_ENTRY");
    expect(result.evidenceRefId).toBe("entry-42");
  });
});

describe("fromWebsitePageSections", () => {
  it("assembles the document envelope from pre-chunked sections without altering them", () => {
    const sections = [
      { id: "s1", context: "PRODUCT" as const, heading: "Kit TRAVO", text: "Compatible con Hilux 2016+" },
      { id: "s2", context: "TESTIMONIAL" as const, heading: null, text: "Llegó en un día" },
    ];

    const result = fromWebsitePageSections({ id: "page-1", url: "https://koriakiimport.com/tienda", title: "Tienda" }, sections);

    expect(result).toEqual({
      id: "page-1",
      url: "https://koriakiimport.com/tienda",
      title: "Tienda",
      sections,
      evidenceRefType: "WEBSITE_PAGE",
      evidenceRefId: "page-1",
    });
  });
});
