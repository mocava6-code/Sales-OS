import { describe, expect, it, vi } from "vitest";
import { applyWhatsAppContactName } from "../lead-service";

function fakeDb(overrides: { update?: ReturnType<typeof vi.fn> } = {}) {
  return { lead: { update: overrides.update ?? vi.fn().mockResolvedValue({}) } } as never;
}

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
