// Deterministic keyword/pattern detectors — one pure function per
// keyword-based ObservationType. Keyword lists are simple exported `const`
// arrays so they're easy to tune later without touching detector logic.
// Spanish/Portuguese first (Kori's primary LatAm/Brazil market — see
// ARCHITECTURE.md's LGPD/LatAm notes), English as a fallback.
//
// Content is normalized (lowercase + diacritics stripped) before matching so
// "cuánto" / "cuanto", "preço" / "preco" etc. all match the same ASCII
// keyword list.

import type { MessageReceivedEvent } from "../../../domain-events/types";
import type { Observation } from "../types";

// Matches combining diacritical marks (U+0300-U+036F) left behind by
// String.prototype.normalize("NFD") — e.g. "á" -> "a" + U+0301.
const DIACRITICS_PATTERN = /[̀-ͯ]/g;

export function normalizeContent(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(DIACRITICS_PATTERN, "");
}

function matchesAny(normalized: string, keywords: readonly string[]): boolean {
  return keywords.some((keyword) => normalized.includes(keyword));
}

function toObservation(type: Observation["type"], summary: string, event: MessageReceivedEvent): Observation {
  return {
    type,
    summary,
    evidence: [{ sourceType: "conversation_message", sourceId: event.conversationEntryId, excerpt: event.content }],
  };
}

// Discount-specific keywords are deliberately distinct from generic price
// keywords below — a message can match one, the other, or both
// independently (they are not mutually exclusive classifications).
export const DISCOUNT_KEYWORDS = [
  "descuento",
  "desconto",
  "discount",
  "rebaja",
  "rebaixa",
  "mejor precio",
  "melhor preco",
  "promocion",
  "promocao",
  "oferta",
] as const;

export const PRICE_KEYWORDS = [
  "precio",
  "preco",
  "cuanto cuesta",
  "cuanto vale",
  "cuanto sale",
  "quanto custa",
  "quanto e",
  "quanto fica",
  "price",
  "cost",
  "how much",
  "valor",
] as const;

export const COMPATIBILITY_KEYWORDS = [
  "compatible",
  "compatibilidad",
  "compatibilidade",
  "funciona con",
  "funciona para",
  "funciona com",
  "sirve para",
  "serve para",
  "fits my",
  "fits a",
] as const;

export const INSTALLATION_KEYWORDS = [
  "instalar",
  "instalacion",
  "instalacao",
  "install",
  "installation",
  "montar",
  "montagem",
  "how to install",
] as const;

export const PHOTO_KEYWORDS = [
  "foto",
  "fotos",
  "photo",
  "picture",
  "imagen",
  "imagem",
  "manda foto",
  "envia foto",
  "manda uma foto",
  "manda una foto",
] as const;

/** Discount negotiation checked independently from plain price requests — see DISCOUNT_KEYWORDS above. */
export function detectDiscountNegotiation(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, DISCOUNT_KEYWORDS)) return null;
  return toObservation("DISCOUNT_NEGOTIATION", "Customer asked for a discount or better price.", event);
}

export function detectPriceRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, PRICE_KEYWORDS)) return null;
  return toObservation("PRICE_REQUEST", "Customer asked about price.", event);
}

export function detectCompatibilityQuestion(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, COMPATIBILITY_KEYWORDS)) return null;
  return toObservation("COMPATIBILITY_QUESTION", "Customer asked whether a product is compatible.", event);
}

export function detectInstallationQuestion(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, INSTALLATION_KEYWORDS)) return null;
  return toObservation("INSTALLATION_QUESTION", "Customer asked about installation.", event);
}

export function detectPhotoRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, PHOTO_KEYWORDS)) return null;
  return toObservation("PHOTO_REQUEST", "Customer asked for a photo.", event);
}

export const KEYWORD_DETECTORS = [
  detectDiscountNegotiation,
  detectPriceRequest,
  detectCompatibilityQuestion,
  detectInstallationQuestion,
  detectPhotoRequest,
] as const;
