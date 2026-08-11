// Gated: proves findOrCreateLeadByPhone's Kori Data Correctness Phase 1D
// backward-compatibility transition fix against real Postgres
// (sales_os_test) — a legacy-format existing Lead is found and reused
// (never duplicated), tenant isolation holds, a pre-existing duplicate
// pair is never auto-merged, and the whole thing never writes anything
// beyond a single Lead.create() when genuinely no match exists.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizePhoneToE164, normalizeWhatsAppPhoneToE164 } from "@/lib/phone";
import { findOrCreateLeadByPhone } from "../lead-service";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../persistence/__tests__/test-db";

describe.skipIf(!shouldRunDbTests)("findOrCreateLeadByPhone — backward-compatible legacy lookup (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "lead-phone-lookup"); // base lead: phone "+10000000000" — unrelated to the numbers below
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("1. a legacy digits-only existing Lead (no leading '+') is found and reused, never duplicated", async () => {
    const legacy = await db!.lead.create({ data: { businessId: fixture.businessId, name: "prueba", phone: "51933517901" } });
    try {
      const before = await db!.lead.count({ where: { businessId: fixture.businessId } });

      const result = await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);

      expect(result.id).toBe(legacy.id);
      const after = await db!.lead.count({ where: { businessId: fixture.businessId } });
      expect(after).toBe(before); // no new Lead created
    } finally {
      await db!.lead.delete({ where: { id: legacy.id } });
    }
  });

  it("2. a canonical existing Lead ('+' prefixed) is found and reused", async () => {
    const canonical = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Juan Pérez", phone: "+51933517901" } });
    try {
      const before = await db!.lead.count({ where: { businessId: fixture.businessId } });

      const result = await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);

      expect(result.id).toBe(canonical.id);
      const after = await db!.lead.count({ where: { businessId: fixture.businessId } });
      expect(after).toBe(before);
    } finally {
      await db!.lead.delete({ where: { id: canonical.id } });
    }
  });

  it("3. no existing Lead for this number creates exactly one new Lead, stored canonically (with '+')", async () => {
    const result = await findOrCreateLeadByPhone(fixture.businessId, "+51900000777", db!);
    try {
      expect(result.phone).toBe("+51900000777");
      const stored = await db!.lead.findUnique({ where: { id: result.id } });
      expect(stored?.phone).toBe("+51900000777");
    } finally {
      await db!.lead.delete({ where: { id: result.id } });
    }
  });

  it("4. two businesses with the same real phone remain isolated — each resolves to its OWN Lead", async () => {
    const other = await createTestFixture(db!, "lead-phone-lookup-other");
    const legacyMine = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Mine (legacy)", phone: "51933517901" } });
    const canonicalTheirs = await db!.lead.create({ data: { businessId: other.businessId, name: "Theirs (canonical)", phone: "+51933517901" } });

    try {
      const mine = await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);
      const theirs = await findOrCreateLeadByPhone(other.businessId, "+51933517901", db!);

      expect(mine.id).toBe(legacyMine.id);
      expect(theirs.id).toBe(canonicalTheirs.id);
      expect(mine.id).not.toBe(theirs.id);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [legacyMine.id, canonicalTheirs.id] } } });
      await cleanupTestFixture(db!, other);
    }
  });

  it("5. never suffix-matches — a Lead whose phone happens to be the bare national digits (a substring of the candidate set) is NOT matched", async () => {
    // "933517901" is the national-significant-number substring of
    // "+51933517901"/"51933517901" — deliberately NOT one of the two
    // explicit lookup candidates (see buildLegacyPhoneLookupCandidates's
    // own doc comment on why a third candidate isn't included). An
    // unrelated Lead stored under that bare substring must never be
    // treated as a match — this proves the lookup is exact-string only,
    // never fuzzy/suffix.
    const unrelated = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Bare national digits", phone: "933517901" } });
    try {
      const result = await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);
      expect(result.id).not.toBe(unrelated.id);
      expect(result.phone).toBe("+51933517901"); // a NEW canonical Lead was created instead
    } finally {
      await db!.lead.delete({ where: { id: unrelated.id } });
      // findOrCreateLeadByPhone above will have created a second Lead — clean it up too.
      await db!.lead.deleteMany({ where: { businessId: fixture.businessId, phone: "+51933517901" } });
    }
  });

  it("6. manual-entry normalization (normalizePhoneToE164) and WhatsApp normalization (normalizeWhatsAppPhoneToE164) converge on the same Lead", async () => {
    const fromWhatsApp = normalizeWhatsAppPhoneToE164("51933517901");
    const fromManualEntry = normalizePhoneToE164("933517901"); // Peru national format, as the lead form accepts
    expect(fromWhatsApp).toBe(fromManualEntry); // same canonical string, proven in lib/__tests__/phone.test.ts too

    const first = await findOrCreateLeadByPhone(fixture.businessId, fromWhatsApp, db!);
    const second = await findOrCreateLeadByPhone(fixture.businessId, fromManualEntry, db!);

    try {
      expect(second.id).toBe(first.id); // the "WhatsApp path" and "manual path" resolve to the SAME Lead
    } finally {
      await db!.lead.delete({ where: { id: first.id } });
    }
  });

  it("7. a duplicate pair that already exists is NOT automatically merged — both rows survive untouched", async () => {
    const legacy = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Legacy Copy", phone: "51933517901" } });
    const canonical = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Canonical Copy", phone: "+51933517901" } });

    try {
      const before = await db!.lead.count({ where: { businessId: fixture.businessId } });
      const result = await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);
      const after = await db!.lead.count({ where: { businessId: fixture.businessId } });

      // No merge: total row count is unchanged, and BOTH original rows
      // still exist, completely unmodified.
      expect(after).toBe(before);
      const stillLegacy = await db!.lead.findUnique({ where: { id: legacy.id } });
      const stillCanonical = await db!.lead.findUnique({ where: { id: canonical.id } });
      expect(stillLegacy?.name).toBe("Legacy Copy");
      expect(stillLegacy?.phone).toBe("51933517901");
      expect(stillCanonical?.name).toBe("Canonical Copy");
      expect(stillCanonical?.phone).toBe("+51933517901");
      // Deterministic tie-break: the older of the two pre-existing rows is
      // the one reused (never an arbitrary/unstable choice).
      expect(result.id).toBe(legacy.id);
    } finally {
      await db!.lead.deleteMany({ where: { id: { in: [legacy.id, canonical.id] } } });
    }
  });

  it("8. never calls a write method beyond a single create() when no match exists, and never calls one at all when a match IS found", async () => {
    const existing = await db!.lead.create({ data: { businessId: fixture.businessId, name: "Existing", phone: "51933517901" } });
    const updateSpy = vi.spyOn(db!.lead, "update");
    const deleteSpy = vi.spyOn(db!.lead, "delete");
    const upsertSpy = vi.spyOn(db!.lead, "upsert");
    const createSpy = vi.spyOn(db!.lead, "create");
    const rawSpy = vi.spyOn(db!, "$queryRaw");
    const execSpy = vi.spyOn(db!, "$executeRaw");

    try {
      // Match found — no write of any kind.
      await findOrCreateLeadByPhone(fixture.businessId, "+51933517901", db!);
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(rawSpy).not.toHaveBeenCalled();
      expect(execSpy).not.toHaveBeenCalled();

      // No match — exactly one create(), still never update/delete/upsert/raw.
      const created = await findOrCreateLeadByPhone(fixture.businessId, "+51900000888", db!);
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(upsertSpy).not.toHaveBeenCalled();
      expect(rawSpy).not.toHaveBeenCalled();
      expect(execSpy).not.toHaveBeenCalled();

      await db!.lead.delete({ where: { id: created.id } });
    } finally {
      await db!.lead.delete({ where: { id: existing.id } });
    }
  });
});
