// Deterministic free-text product/vehicle extractor — no catalog
// dependency (that's server/intelligence/lead-commercial-state/extractors/
// catalog-product-extractor.ts, a later, higher-confidence tier added once
// a business has configured KnowledgeItem product entries — sequence step
// (m), not this one). This tier matches against a small, static vocabulary
// shipped in code, the same "hardcoded keyword list, tuned over time"
// pattern already used by the Observation Engine's keyword detectors —
// deliberately lower confidence (0.6) than a future catalog match (~0.9),
// so a configured catalog always wins once it exists.
//
// vehicleBrand, vehicleModel, vehicleYear, and productInterest all come
// from ONE detection pass over a message (a message either mentions a
// vehicle+product or it doesn't) but are exposed as four separate
// FieldExtractor<T> objects, one per LeadCommercialState field — each can
// be persisted (and independently out-competed by a higher-confidence
// AI/human value) without the others.

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction } from "../types";

/**
 * Canonical display casing per known vehicle model — keys are
 * pre-normalized (lowercase, no diacritics). Multi-word keys supported
 * (every token must be present, not necessarily adjacent — same tradeoff
 * as "land cruiser").
 *
 * KEEP THIS EXACT SET STABLE: server/knowledge/deterministic/rules/
 * compatibility-rule.ts (unrelated, in-progress Knowledge Ingestion work)
 * imports this constant directly for its own vehicle-compatibility
 * matching — adding a model here changes that system's behavior too, not
 * just Lead Commercial State's. Ford models added for Kori Data
 * Correctness Phase 1C (Ranger/Raptor/F150) deliberately live in
 * COMMERCIAL_STATE_VEHICLE_MODELS below instead, which only this file's
 * own extractors use.
 */
export const KNOWN_VEHICLE_MODELS: Record<string, string> = {
  hilux: "Hilux",
  fortuner: "Fortuner",
  corolla: "Corolla",
  hiace: "Hiace",
  yaris: "Yaris",
  rav4: "RAV4",
  "land cruiser": "Land Cruiser",
};

/**
 * KNOWN_VEHICLE_MODELS plus the Ford models Kori Data Correctness Phase 1C
 * adds — used ONLY by this file's own vehicleModel/vehicleBrand/
 * vehicleYear/productInterest extractors, never exported for
 * compatibility-rule.ts to pick up.
 */
const COMMERCIAL_STATE_VEHICLE_MODELS: Record<string, string> = {
  ...KNOWN_VEHICLE_MODELS,
  ranger: "Ranger",
  raptor: "Raptor",
  // "F-150"/"F 150" tokenize to two tokens ("f","150" — the hyphen/space
  // both split on tokenize()'s non-alphanumeric boundary); "F150" (no
  // separator) tokenizes to one ("f150"). Both entries recognize the same
  // real-world model under either spelling.
  f150: "F150",
  "f 150": "F150",
};

/**
 * Explicit, hand-maintained model -> brand mapping — never fuzzy/AI
 * inference. "Raptor" is deliberately NOT here: it's ambiguous on its own
 * (see resolveVehicleBrand), so it's handled as a special case instead of
 * an unconditional table entry.
 */
export const KNOWN_VEHICLE_MODEL_TO_BRAND: Record<string, string> = {
  Hilux: "Toyota",
  Fortuner: "Toyota",
  Corolla: "Toyota",
  Hiace: "Toyota",
  Yaris: "Toyota",
  RAV4: "Toyota",
  "Land Cruiser": "Toyota",
  Ranger: "Ford",
  F150: "Ford",
};

/** Tokens (already normalized — lowercase, no diacritics) whose presence identifies the message as being about a Ford vehicle — the context "Raptor" alone needs to resolve to Ford. */
const FORD_CONTEXT_TOKENS = new Set(["ford", "f150"]);

/**
 * Raptor is a real vehicle model name, but ambiguous as a BRAND signal on
 * its own (it isn't exclusively a Ford nameplate in every context) — per
 * explicit instruction, only infer Ford when the same message also
 * mentions Ford or F150/F-150. Every other known model has one
 * unconditional brand. Still fully deterministic: a fixed table lookup
 * plus one token-presence check, never a guess.
 */
function resolveVehicleBrand(vehicleModel: string, tokenSet: Set<string>): string | null {
  if (vehicleModel === "Raptor") {
    return [...FORD_CONTEXT_TOKENS].some((token) => tokenSet.has(token)) ? "Ford" : null;
  }
  return KNOWN_VEHICLE_MODEL_TO_BRAND[vehicleModel] ?? null;
}

/** Business-specific product-line/kit names — not a generic vehicle trim list, a static vocabulary of this business's own product names. */
export const KNOWN_PRODUCT_LINES: Record<string, string> = {
  travo: "TRAVO",
};

export const PRODUCT_TYPE_KEYWORDS: Record<string, string> = {
  kit: "kit",
  repuesto: "repuesto",
  repuestos: "repuestos",
  accesorio: "accesorio",
  accesorios: "accesorios",
};

const YEAR_PATTERN = /^(19|20)\d{2}$/;
const FREETEXT_EXTRACTOR_VERSION = "2.0.0";
const FREETEXT_CONFIDENCE = 0.6;
const FREETEXT_REASONING = "Free-text match against a static vehicle/product vocabulary — no product catalog configured yet.";

function tokenize(content: string): string[] {
  return normalizeContent(content).split(/[^a-z0-9]+/).filter(Boolean);
}

function findCanonicalMatch(tokenSet: Set<string>, dictionary: Record<string, string>): string | null {
  for (const [key, canonical] of Object.entries(dictionary)) {
    const keyTokens = key.split(" ");
    if (keyTokens.every((t) => tokenSet.has(t))) {
      return canonical;
    }
  }
  return null;
}

interface VehicleProductMatch {
  vehicleBrand: string | null;
  vehicleModel: string;
  vehicleYear: number | null;
  productInterest: string | null;
}

function matchVehicleAndProduct(message: NormalizedMessageForExtraction): VehicleProductMatch | null {
  const tokens = tokenize(message.content);
  const tokenSet = new Set(tokens);

  const vehicleModel = findCanonicalMatch(tokenSet, COMMERCIAL_STATE_VEHICLE_MODELS);
  if (!vehicleModel) return null;

  const vehicleBrand = resolveVehicleBrand(vehicleModel, tokenSet);

  const yearToken = tokens.find((t) => YEAR_PATTERN.test(t)) ?? null;
  const vehicleYear = yearToken ? Number(yearToken) : null;

  const productLine = findCanonicalMatch(tokenSet, KNOWN_PRODUCT_LINES);
  const productType = findCanonicalMatch(tokenSet, PRODUCT_TYPE_KEYWORDS);
  // Either part alone is meaningful ("repuestos" with no named product
  // line is still a real productInterest) — not gated on productLine being
  // present first.
  const productInterest = [productLine, productType].filter((part): part is string => Boolean(part)).join(" ") || null;

  return { vehicleBrand, vehicleModel, vehicleYear, productInterest };
}

function toCandidate<T>(value: T, message: NormalizedMessageForExtraction): FieldCandidate<T> {
  return {
    value,
    confidence: FREETEXT_CONFIDENCE,
    conversationId: message.conversationId,
    occurredAt: message.occurredAt,
    evidence: [{ sourceType: "conversation_message", sourceId: message.id, excerpt: message.content }],
    reasoning: FREETEXT_REASONING,
  };
}

export const vehicleModelExtractor: FieldExtractor<string> = {
  id: "freetext.vehicle_model",
  version: FREETEXT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<string>[] {
    return messages.flatMap((message) => {
      const match = matchVehicleAndProduct(message);
      return match ? [toCandidate(match.vehicleModel, message)] : [];
    });
  },
};

export const vehicleBrandExtractor: FieldExtractor<string> = {
  id: "freetext.vehicle_brand",
  version: FREETEXT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<string>[] {
    return messages.flatMap((message) => {
      const match = matchVehicleAndProduct(message);
      return match?.vehicleBrand ? [toCandidate(match.vehicleBrand, message)] : [];
    });
  },
};

export const vehicleYearExtractor: FieldExtractor<number> = {
  id: "freetext.vehicle_year",
  version: FREETEXT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<number>[] {
    return messages.flatMap((message) => {
      const match = matchVehicleAndProduct(message);
      return match?.vehicleYear !== null && match?.vehicleYear !== undefined ? [toCandidate(match.vehicleYear, message)] : [];
    });
  },
};

export const productInterestExtractor: FieldExtractor<string> = {
  id: "freetext.product_interest",
  version: FREETEXT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<string>[] {
    return messages.flatMap((message) => {
      const match = matchVehicleAndProduct(message);
      return match?.productInterest ? [toCandidate(match.productInterest, message)] : [];
    });
  },
};
