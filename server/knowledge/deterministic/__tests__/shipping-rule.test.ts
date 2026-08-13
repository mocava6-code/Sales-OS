import { describe, expect, it } from "vitest";
import { extractShippingCandidates } from "../rules/shipping-rule";
import type { ExtractionInput } from "../../types";

function conversationInput(role: "BUSINESS" | "CUSTOMER", content: string): ExtractionInput {
  return {
    kind: "CONVERSATION",
    messages: [{ id: "m0", role, content, occurredAt: new Date(), evidenceRefType: "IMPORTED_MESSAGE", evidenceRefId: "msg-1" }],
  };
}

function documentInput(text: string, context: "SERVICE" | "MARKETING", reliable = true): ExtractionInput {
  return {
    kind: "DOCUMENT",
    document: {
      id: "page-1",
      url: "https://koriakiimport.com/servicios",
      title: "Servicios",
      sections: [{ id: "s0", context, heading: null, text, reliable }],
      evidenceRefType: "WEBSITE_PAGE",
      evidenceRefId: "page-1",
    },
  };
}

describe("extractShippingCandidates — general policy statements", () => {
  it("fires on a general nationwide-shipping BUSINESS statement", () => {
    const input = conversationInput("BUSINESS", "Para provincia enviamos por Shalom.");
    const [candidate] = extractShippingCandidates(input);
    expect(candidate).toMatchObject({ proposedCategory: "LOGISTICS", subject: "Envíos" });
  });

  it("fires on 'envíos a nivel nacional' phrasing", () => {
    const input = conversationInput("BUSINESS", "Hacemos envíos a nivel nacional.");
    expect(extractShippingCandidates(input)).toHaveLength(1);
  });

  it("never fires on a CUSTOMER's own delivery address — that's a different signal entirely", () => {
    const input = conversationInput("CUSTOMER", "¿Me pueden enviar a mi casa en Surco?");
    expect(extractShippingCandidates(input)).toHaveLength(0);
  });

  it("does not fire on unrelated BUSINESS text", () => {
    const input = conversationInput("BUSINESS", "Claro, dame un momento para verificar el stock.");
    expect(extractShippingCandidates(input)).toHaveLength(0);
  });
});

describe("extractShippingCandidates — website documents", () => {
  it("fires on a SERVICE section describing national shipping", () => {
    const input = documentInput("Contamos con envíos a nivel nacional a través de Shalom.", "SERVICE");
    expect(extractShippingCandidates(input)).toHaveLength(1);
  });

  it("never fires on a MARKETING section", () => {
    const input = documentInput("¡Envíos a nivel nacional, los más rápidos del Perú!", "MARKETING");
    expect(extractShippingCandidates(input)).toHaveLength(0);
  });

  it("never fires on an unreliable (fallback-tier) section, even with a matching phrase", () => {
    const input = documentInput("Contamos con envíos a nivel nacional a través de Shalom.", "SERVICE", false);
    expect(extractShippingCandidates(input)).toHaveLength(0);
  });
});
