import { describe, expect, it } from "vitest";
import { extractCompatibilityCandidates } from "../rules/compatibility-rule";
import type { ExtractionDocumentSection, ExtractionInput } from "../../types";

function conversationInput(role: "BUSINESS" | "CUSTOMER" | "UNKNOWN", content: string): ExtractionInput {
  return {
    kind: "CONVERSATION",
    messages: [{ id: "m0", role, content, occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-1" }],
  };
}

function documentInput(
  text: string,
  context: "PRODUCT" | "MARKETING" | "TESTIMONIAL",
  overrides: Partial<Pick<ExtractionDocumentSection, "subjectHint" | "reliable">> & { title?: string | null } = {},
): ExtractionInput {
  return {
    kind: "DOCUMENT",
    document: {
      id: "page-1",
      url: "https://koriakiimport.com/tienda",
      title: overrides.title === undefined ? "Tienda" : overrides.title,
      sections: [{ id: "s0", context, heading: null, text, reliable: overrides.reliable ?? true, subjectHint: overrides.subjectHint ?? null }],
      evidenceRefType: "WEBSITE_PAGE",
      evidenceRefId: "page-1",
    },
  };
}

describe("extractCompatibilityCandidates — conversations", () => {
  it("fires on a BUSINESS message with a compatibility keyword and a known vehicle model", () => {
    const input = conversationInput("BUSINESS", "Sí, el TRAVO sirve para Hilux Revo desde 2016.");
    const [candidate] = extractCompatibilityCandidates(input);

    expect(candidate).toBeDefined();
    expect(candidate).toMatchObject({ class: "FACTUAL", proposedCategory: "COMPATIBILITY", subject: "Hilux TRAVO" });
    expect(candidate.evidenceRefId).toBe("msg-1");
  });

  it("never fires on a CUSTOMER message, even with the same wording", () => {
    const input = conversationInput("CUSTOMER", "¿El TRAVO sirve para mi Hilux 2018?");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  it("never fires on an UNKNOWN-role message", () => {
    const input = conversationInput("UNKNOWN", "El TRAVO sirve para Hilux.");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  it("does not fire without a recognized vehicle model, even with a compatibility keyword — no structural subject available on WhatsApp text", () => {
    const input = conversationInput("BUSINESS", "Sí, es compatible con la mayoría de camionetas.");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  it("does not fire on a vehicle mention with no compatibility language", () => {
    const input = conversationInput("BUSINESS", "Tengo una Hilux en el taller ahora mismo.");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });
});

describe("extractCompatibilityCandidates — website documents", () => {
  it("fires on a PRODUCT section", () => {
    const input = documentInput("El TRAVO es compatible con Hilux Revo desde 2016.", "PRODUCT");
    const [candidate] = extractCompatibilityCandidates(input);
    expect(candidate).toMatchObject({ proposedCategory: "COMPATIBILITY", chunkContext: "PRODUCT" });
  });

  it("never fires on a TESTIMONIAL section, even with matching keywords", () => {
    const input = documentInput("El TRAVO es compatible con mi Hilux, quedé feliz con la compra.", "TESTIMONIAL");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  it("never fires on a MARKETING section", () => {
    const input = documentInput("¡El TRAVO compatible con Hilux, el mejor del mercado!", "MARKETING");
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  it("never fires on an unreliable (fallback-tier) section, even with matching keywords and a known vehicle", () => {
    const input = documentInput("Compatible con Hilux Revo desde 2016.", "PRODUCT", { reliable: false });
    expect(extractCompatibilityCandidates(input)).toHaveLength(0);
  });

  describe("structural subject preference (Sprint 8 quality-fix review, item 2)", () => {
    it("prefers the section's own subjectHint (a product card/heading title) over a dictionary-derived subject", () => {
      const input = documentInput("Compatible con Hilux Revo 2016–2024", "PRODUCT", { subjectHint: "Faros LED Hilux Revo" });
      const [candidate] = extractCompatibilityCandidates(input);
      expect(candidate.subject).toBe("Faros LED Hilux Revo");
    });

    it("falls back to the page title when no section-level subjectHint exists", () => {
      const input = documentInput("Compatible con Hilux Revo.", "PRODUCT", { subjectHint: null, title: "Faros LED Hilux — Koriaki" });
      const [candidate] = extractCompatibilityCandidates(input);
      expect(candidate.subject).toBe("Faros LED Hilux — Koriaki");
    });

    it("falls back to the dictionary when neither subjectHint nor page title exist", () => {
      const input = documentInput("Compatible con Hilux Revo desde 2016.", "PRODUCT", { subjectHint: null, title: null });
      const [candidate] = extractCompatibilityCandidates(input);
      expect(candidate.subject).toBe("Hilux");
    });

    it("a structural subject unlocks vehicles the small dictionary has never known about (Ranger, F-150, Prado) — the real-world gap this fix closes", () => {
      const input = documentInput("Compatible con Ranger Raptor.", "PRODUCT", { subjectHint: "Parrilla Ranger Raptor" });
      const [candidate] = extractCompatibilityCandidates(input);
      expect(candidate).toBeDefined();
      expect(candidate.subject).toBe("Parrilla Ranger Raptor");
    });

    it("without a structural subject, an unrecognized vehicle (not in KNOWN_VEHICLE_MODELS) still produces no candidate", () => {
      const input = documentInput("Compatible con Ranger Raptor.", "PRODUCT", { subjectHint: null, title: null });
      expect(extractCompatibilityCandidates(input)).toHaveLength(0);
    });
  });

  describe("affirmative statement required (Sprint 8 quality-fix review, item 3)", () => {
    it("(regression) never fires on a rhetorical question mentioning brands and a compatibility keyword, with no declarative sentence", () => {
      const input = documentInput("¿Buscas piezas para tu Toyota o Ford?", "PRODUCT", { subjectHint: "Home" });
      expect(extractCompatibilityCandidates(input)).toHaveLength(0);
    });

    it("(regression) never fires when the only compatibility-keyword sentence in the block is itself a question", () => {
      const input = documentInput(
        "De la búsqueda a la instalación en 5 pasos. ¿Es compatible con tu modelo? Escríbenos para confirmarlo.",
        "PRODUCT",
        { subjectHint: "Cómo funciona" },
      );
      expect(extractCompatibilityCandidates(input)).toHaveLength(0);
    });

    it("still fires when a declarative compatibility sentence is present alongside an unrelated question in the same block", () => {
      const input = documentInput(
        "¿No encuentras tu modelo? El TRAVO es compatible con Hilux Revo desde 2016.",
        "PRODUCT",
        { subjectHint: "Kit TRAVO" },
      );
      const [candidate] = extractCompatibilityCandidates(input);
      expect(candidate).toBeDefined();
      expect(candidate.subject).toBe("Kit TRAVO");
    });
  });
});
