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

// --- Business intelligence mission — intent signals ---------------------------

export const QUOTE_KEYWORDS = ["cotizacion", "cotizar", "cotizame", "orcamento", "quote", "quotation"] as const;

export const AVAILABILITY_KEYWORDS = [
  "tienen stock",
  "hay stock",
  "tienen disponible",
  "esta disponible",
  "tienen para",
  "em estoque",
  "disponivel",
  "in stock",
  "available",
] as const;

export const DELIVERY_TIME_KEYWORDS = [
  "en que tiempo",
  "cuanto demora",
  "cuanto tarda",
  "tiempo de entrega",
  "para cuando",
  "em quanto tempo",
  "delivery time",
  "how long",
] as const;

export const PAYMENT_METHOD_KEYWORDS = [
  "como pago",
  "como puedo pagar",
  "formas de pago",
  "numero de cuenta",
  "yape",
  "plin",
  "como faco para pagar",
  "payment method",
  "how do i pay",
] as const;

export function detectQuoteRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, QUOTE_KEYWORDS)) return null;
  return toObservation("QUOTE_REQUEST", "Customer asked for a formal quote.", event);
}

export function detectAvailabilityRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, AVAILABILITY_KEYWORDS)) return null;
  return toObservation("AVAILABILITY_REQUEST", "Customer asked whether a product is available/in stock.", event);
}

export function detectDeliveryTimeRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, DELIVERY_TIME_KEYWORDS)) return null;
  return toObservation("DELIVERY_TIME_REQUEST", "Customer asked how long delivery/installation would take.", event);
}

export function detectPaymentMethodRequest(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, PAYMENT_METHOD_KEYWORDS)) return null;
  return toObservation("PAYMENT_METHOD_REQUEST", "Customer asked how to pay.", event);
}

// --- Business intelligence mission — friction signals --------------------------
// A customer expressing an obstacle, not merely asking a neutral question —
// e.g. PRICE_REQUEST ("¿cuánto cuesta?") vs PRICE_OBJECTION ("está muy caro").

export const PRICE_OBJECTION_KEYWORDS = ["muy caro", "muito caro", "no me alcanza", "mas barato", "mais barato", "too expensive"] as const;

export const AVAILABILITY_FRICTION_KEYWORDS = ["no hay stock", "no tienen", "agotado", "sem estoque", "esgotado", "out of stock"] as const;

export const DELIVERY_LOCATION_FRICTION_KEYWORDS = [
  "no llegan",
  "no hacen envios",
  "no envian a",
  "nao entregam",
  "dont deliver",
  "don't deliver",
] as const;

export const INSTALLATION_FRICTION_KEYWORDS = ["no instalan", "no hacen instalacion", "nao instalam", "dont install", "don't install"] as const;

export const TRUST_FRICTION_KEYWORDS = ["es seguro", "es confiable", "estafa", "e confiavel", "golpe", "is this safe", "is this legit", "scam"] as const;

export const TIMING_FRICTION_KEYWORDS = ["muy lento", "mucho tiempo", "muito tempo", "demora mucho", "too slow", "too long"] as const;

export function detectPriceObjection(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, PRICE_OBJECTION_KEYWORDS)) return null;
  return toObservation("PRICE_OBJECTION", "Customer objected to the price.", event);
}

export function detectAvailabilityFriction(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, AVAILABILITY_FRICTION_KEYWORDS)) return null;
  return toObservation("AVAILABILITY_FRICTION", "Customer hit an out-of-stock/unavailable obstacle.", event);
}

export function detectDeliveryLocationFriction(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, DELIVERY_LOCATION_FRICTION_KEYWORDS)) return null;
  return toObservation("DELIVERY_LOCATION_FRICTION", "Customer hit a delivery-location obstacle (Koriaki doesn't ship there).", event);
}

export function detectInstallationFriction(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, INSTALLATION_FRICTION_KEYWORDS)) return null;
  return toObservation("INSTALLATION_FRICTION", "Customer hit an installation-availability obstacle.", event);
}

export function detectTrustFriction(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, TRUST_FRICTION_KEYWORDS)) return null;
  return toObservation("TRUST_FRICTION", "Customer expressed doubt about legitimacy/trust.", event);
}

export function detectTimingFriction(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, TIMING_FRICTION_KEYWORDS)) return null;
  return toObservation("TIMING_FRICTION", "Customer complained about slowness/timing.", event);
}

// --- Business intelligence mission — geography signals --------------------------
// Coarse Lima-vs-provincia presence signal — NOT the canonical resolved
// deliveryLocation fact (server/intelligence/lead-commercial-state/
// extractors/location-extractor.ts already owns that); this only records
// that the topic came up, for demand-by-region reporting.

export const LIMA_KEYWORDS = ["lima", "miraflores", "surco", "callao", " ate ", "la molina", "chosica", "chaclacayo"] as const;

export const PROVINCE_KEYWORDS = [
  "provincia",
  "huanuco",
  "ayacucho",
  "cusco",
  "arequipa",
  "trujillo",
  "chiclayo",
  "piura",
  "iquitos",
  "huancayo",
  "tacna",
  "puno",
  "cajamarca",
] as const;

export function detectLimaMentioned(event: MessageReceivedEvent): Observation | null {
  const normalized = ` ${normalizeContent(event.content)} `;
  if (!matchesAny(normalized, LIMA_KEYWORDS)) return null;
  return toObservation("LIMA_MENTIONED", "Customer mentioned Lima or a Lima district.", event);
}

export function detectProvinceMentioned(event: MessageReceivedEvent): Observation | null {
  const normalized = normalizeContent(event.content);
  if (!matchesAny(normalized, PROVINCE_KEYWORDS)) return null;
  return toObservation("PROVINCE_MENTIONED", "Customer mentioned a province/region outside Lima.", event);
}

export const KEYWORD_DETECTORS = [
  detectDiscountNegotiation,
  detectPriceRequest,
  detectCompatibilityQuestion,
  detectInstallationQuestion,
  detectPhotoRequest,
  detectQuoteRequest,
  detectAvailabilityRequest,
  detectDeliveryTimeRequest,
  detectPaymentMethodRequest,
  detectPriceObjection,
  detectAvailabilityFriction,
  detectDeliveryLocationFriction,
  detectInstallationFriction,
  detectTrustFriction,
  detectTimingFriction,
  detectLimaMentioned,
  detectProvinceMentioned,
] as const;
