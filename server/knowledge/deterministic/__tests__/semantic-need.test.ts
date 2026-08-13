import { describe, expect, it } from "vitest";
import { assessSemanticAnalysisNeed } from "../semantic-need";
import type { ExtractionInput } from "../../types";

function conversationInput(...contents: string[]): ExtractionInput {
  return {
    kind: "CONVERSATION",
    messages: contents.map((content, i) => ({
      id: `m${i}`,
      role: "CUSTOMER" as const,
      content,
      occurredAt: new Date(),
      evidenceRefType: "IMPORTED_MESSAGE" as const,
      evidenceRefId: `msg-${i}`,
    })),
  };
}

function documentInput(context: "PRODUCT" | "MARKETING" | "TESTIMONIAL" | "UNKNOWN", text: string): ExtractionInput {
  return {
    kind: "DOCUMENT",
    document: {
      id: "page-1",
      url: "https://koriakiimport.com/tienda",
      title: "Tienda",
      sections: [{ id: "s0", context, heading: null, text, reliable: true }],
      evidenceRefType: "WEBSITE_PAGE",
      evidenceRefId: "page-1",
    },
  };
}

describe("assessSemanticAnalysisNeed — conversations", () => {
  it("is NOT_NEEDED for a conversation of only greetings/acknowledgments", () => {
    const input = conversationInput("Hola", "Gracias", "Perfecto", "Chau");
    expect(assessSemanticAnalysisNeed(input)).toBe("NOT_NEEDED");
  });

  it("is PENDING for a substantive, non-trivial message", () => {
    const input = conversationInput("Hola", "Quisiera saber si tienen el kit disponible en color negro mate para mi camioneta");
    expect(assessSemanticAnalysisNeed(input)).toBe("PENDING");
  });

  it("is PENDING when a price-topic keyword appears, even in an otherwise short message", () => {
    const input = conversationInput("cuanto cuesta");
    expect(assessSemanticAnalysisNeed(input)).toBe("PENDING");
  });

  it("is PENDING for a discount negotiation", () => {
    const input = conversationInput("Hola", "¿Me puede hacer un descuento?");
    expect(assessSemanticAnalysisNeed(input)).toBe("PENDING");
  });

  it("is PENDING for an installation question", () => {
    const input = conversationInput("¿Cómo es el proceso de instalación?");
    expect(assessSemanticAnalysisNeed(input)).toBe("PENDING");
  });

  it("is NOT_NEEDED for an empty conversation", () => {
    const input = conversationInput();
    expect(assessSemanticAnalysisNeed(input)).toBe("NOT_NEEDED");
  });
});

describe("assessSemanticAnalysisNeed — website documents", () => {
  it("is PENDING for a substantive PRODUCT/SERVICE/FAQ/POLICY section", () => {
    const input = documentInput("PRODUCT", "El kit TRAVO incluye parachoques, faros LED y guardafangos reforzados para mayor durabilidad.");
    expect(assessSemanticAnalysisNeed(input)).toBe("PENDING");
  });

  it("is NOT_NEEDED for a MARKETING-only page", () => {
    const input = documentInput("MARKETING", "¡Somos los líderes del mercado en accesorios para camionetas 4x4 en todo el Perú!");
    expect(assessSemanticAnalysisNeed(input)).toBe("NOT_NEEDED");
  });

  it("is NOT_NEEDED for a TESTIMONIAL-only page", () => {
    const input = documentInput("TESTIMONIAL", "Excelente atención, mi pedido llegó rápido y en perfecto estado, muy recomendados.");
    expect(assessSemanticAnalysisNeed(input)).toBe("NOT_NEEDED");
  });

  it("is NOT_NEEDED for a trivially short PRODUCT section", () => {
    const input = documentInput("PRODUCT", "Kit TRAVO.");
    expect(assessSemanticAnalysisNeed(input)).toBe("NOT_NEEDED");
  });
});
