import { describe, expect, it } from "vitest";
import { IMPORT_EXTERNAL_ID_PREFIX, computeImportFingerprint, normalizeMessageBodyForFingerprint } from "../historical-import-service";

const base = { conversationId: "conv-1", occurredAt: new Date("2026-07-27T14:05:00.000Z"), direction: "INBOUND" as const, content: "Hola" };

describe("normalizeMessageBodyForFingerprint", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizeMessageBodyForFingerprint("  Hola   mundo  \n")).toBe("Hola mundo");
  });

  it("never lowercases — WhatsApp text is case-meaningful", () => {
    expect(normalizeMessageBodyForFingerprint("Hola")).toBe("Hola");
    expect(normalizeMessageBodyForFingerprint("HOLA")).not.toBe(normalizeMessageBodyForFingerprint("hola"));
  });
});

describe("computeImportFingerprint", () => {
  it("is deterministic — identical input produces the identical fingerprint", () => {
    expect(computeImportFingerprint(base)).toBe(computeImportFingerprint(base));
  });

  it("is whitespace-insensitive on content, since normalization runs first", () => {
    expect(computeImportFingerprint(base)).toBe(computeImportFingerprint({ ...base, content: "  Hola  " }));
  });

  it("is case-sensitive — different capitalization is a different fingerprint", () => {
    expect(computeImportFingerprint(base)).not.toBe(computeImportFingerprint({ ...base, content: "hola" }));
  });

  it("differs by conversationId", () => {
    expect(computeImportFingerprint(base)).not.toBe(computeImportFingerprint({ ...base, conversationId: "conv-2" }));
  });

  it("differs by direction", () => {
    expect(computeImportFingerprint(base)).not.toBe(computeImportFingerprint({ ...base, direction: "OUTBOUND" }));
  });

  it("differs by occurredAt", () => {
    expect(computeImportFingerprint(base)).not.toBe(computeImportFingerprint({ ...base, occurredAt: new Date("2026-07-27T14:06:00.000Z") }));
  });

  it("is always prefixed with the import namespace, never colliding with a real Meta wamid", () => {
    const fingerprint = computeImportFingerprint(base);
    expect(fingerprint.startsWith(IMPORT_EXTERNAL_ID_PREFIX)).toBe(true);
    expect(fingerprint.startsWith("wamid.")).toBe(false);
  });
});
