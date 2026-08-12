import { describe, expect, it, vi } from "vitest";
import { applyWhatsAppContactName, isPlaceholderName } from "../lead-service";

function fakeDb(overrides: { update?: ReturnType<typeof vi.fn> } = {}) {
  return { lead: { update: overrides.update ?? vi.fn().mockResolvedValue({}) } } as never;
}

describe("isPlaceholderName", () => {
  it("true when name exactly equals the current phone", () => {
    expect(isPlaceholderName("+51933517901", "+51933517901")).toBe(true);
  });

  it("true when name equals a legacy (no-plus) representation of the current canonical phone — the phone-canonicalization-backfill regression case", () => {
    // A lead created before Kori Legacy Data Remediation v0's phone
    // canonicalization backfill still has name="51900000001" (its
    // original placeholder), but phone is now "+51900000001" after the
    // backfill rewrote it. A bare `name === phone` check would wrongly
    // stop recognizing this as a placeholder — confirmed by a production
    // data-quality run finding 0% placeholder names despite several leads
    // whose name was visibly still a bare digit string.
    expect(isPlaceholderName("51900000001", "+51900000001")).toBe(true);
  });

  it("false for a real human name, even one that happens to share digits with the phone", () => {
    expect(isPlaceholderName("Juan Pérez", "+51900000001")).toBe(false);
  });
});

describe("applyWhatsAppContactName", () => {
  it("new lead: upgrades the phone placeholder to a non-empty WhatsApp profile name", async () => {
    const update = vi.fn().mockResolvedValue({});
    const lead = { id: "lead-1", name: "+51933517901", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, "Juan Pérez", fakeDb({ update }));

    expect(result).toEqual({ updated: true, name: "Juan Pérez" });
    expect(update).toHaveBeenCalledWith({ where: { id: "lead-1" }, data: { name: "Juan Pérez" } });
  });

  it("existing placeholder lead: gets upgraded the same way as a brand-new one", async () => {
    const update = vi.fn().mockResolvedValue({});
    const lead = { id: "lead-2", name: "51933517901", phone: "51933517901" }; // still the placeholder, an older WhatsApp-created lead

    const result = await applyWhatsAppContactName(lead, "María López", fakeDb({ update }));

    expect(result).toEqual({ updated: true, name: "María López" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("legacy-format placeholder lead whose phone was later canonicalized (backfill) still gets upgraded", async () => {
    const update = vi.fn().mockResolvedValue({});
    const lead = { id: "lead-2b", name: "51900000001", phone: "+51900000001" }; // name predates the phone-canonicalization backfill

    const result = await applyWhatsAppContactName(lead, "Julio César", fakeDb({ update }));

    expect(result).toEqual({ updated: true, name: "Julio César" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("never overwrites a name a human already edited to something real", async () => {
    const update = vi.fn();
    const lead = { id: "lead-3", name: "Juan (VIP)", phone: "+51933517901" }; // human-edited — no longer equals phone

    const result = await applyWhatsAppContactName(lead, "Some Other Name", fakeDb({ update }));

    expect(result).toEqual({ updated: false, name: "Juan (VIP)" });
    expect(update).not.toHaveBeenCalled();
  });

  it("never overwrites a name that was already upgraded by a prior WhatsApp message", async () => {
    const update = vi.fn();
    const lead = { id: "lead-4", name: "Previously Set Name", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, "A Different Name", fakeDb({ update }));

    expect(result).toEqual({ updated: false, name: "Previously Set Name" });
    expect(update).not.toHaveBeenCalled();
  });

  it("missing contactName leaves behavior unchanged — no write", async () => {
    const update = vi.fn();
    const lead = { id: "lead-5", name: "+51933517901", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, undefined, fakeDb({ update }));

    expect(result).toEqual({ updated: false, name: "+51933517901" });
    expect(update).not.toHaveBeenCalled();
  });

  it("blank/whitespace-only contactName is treated the same as missing — no write", async () => {
    const update = vi.fn();
    const lead = { id: "lead-6", name: "+51933517901", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, "   ", fakeDb({ update }));

    expect(result).toEqual({ updated: false, name: "+51933517901" });
    expect(update).not.toHaveBeenCalled();
  });

  it("is a no-op (no write) when the contact name already equals the current name", async () => {
    const update = vi.fn();
    const lead = { id: "lead-7", name: "Juan Pérez", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, "Juan Pérez", fakeDb({ update }));

    expect(result).toEqual({ updated: false, name: "Juan Pérez" });
    expect(update).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace from the applied name", async () => {
    const update = vi.fn().mockResolvedValue({});
    const lead = { id: "lead-8", name: "+51933517901", phone: "+51933517901" };

    const result = await applyWhatsAppContactName(lead, "  Juan Pérez  ", fakeDb({ update }));

    expect(result).toEqual({ updated: true, name: "Juan Pérez" });
    expect(update).toHaveBeenCalledWith({ where: { id: "lead-8" }, data: { name: "Juan Pérez" } });
  });
});
