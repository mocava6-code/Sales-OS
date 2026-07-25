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
// vehicleModel and productInterest share one detection pass (a message
// either mentions a vehicle+product or it doesn't) but are exposed as two
// separate FieldExtractor<string> objects, one per LeadCommercialState field.

import { normalizeContent } from "../../observation/detectors/keyword-detectors";
import type { FieldCandidate, FieldExtractor, NormalizedMessageForExtraction } from "../types";

/** Canonical display casing per known vehicle model — keys are pre-normalized (lowercase, no diacritics). Multi-word keys supported. */
export const KNOWN_VEHICLE_MODELS: Record<string, string> = {
  hilux: "Hilux",
  fortuner: "Fortuner",
  corolla: "Corolla",
  hiace: "Hiace",
  yaris: "Yaris",
  rav4: "RAV4",
  "land cruiser": "Land Cruiser",
};

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
const FREETEXT_EXTRACTOR_VERSION = "1.0.0";
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
  vehicleModel: string;
  productInterest: string;
}

function matchVehicleAndProduct(message: NormalizedMessageForExtraction): VehicleProductMatch | null {
  const tokens = tokenize(message.content);
  const tokenSet = new Set(tokens);

  const brand = findCanonicalMatch(tokenSet, KNOWN_VEHICLE_MODELS);
  if (!brand) return null;

  const productLine = findCanonicalMatch(tokenSet, KNOWN_PRODUCT_LINES);
  const year = tokens.find((t) => YEAR_PATTERN.test(t)) ?? null;
  const productType = findCanonicalMatch(tokenSet, PRODUCT_TYPE_KEYWORDS);

  const vehicleModel = [brand, productLine, year].filter(Boolean).join(" ");
  const productInterest = productType ? `${vehicleModel} ${productType}` : vehicleModel;

  return { vehicleModel, productInterest };
}

function toCandidate(value: string, message: NormalizedMessageForExtraction): FieldCandidate<string> {
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

export const productInterestExtractor: FieldExtractor<string> = {
  id: "freetext.product_interest",
  version: FREETEXT_EXTRACTOR_VERSION,
  extract(messages: NormalizedMessageForExtraction[]): FieldCandidate<string>[] {
    return messages.flatMap((message) => {
      const match = matchVehicleAndProduct(message);
      return match ? [toCandidate(match.productInterest, message)] : [];
    });
  },
};
