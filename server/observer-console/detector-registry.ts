// Static, presentation-only metadata describing which detector is
// associated with each ObservationType (server/intelligence/observation/).
// This is documentation transcribed by a human from reading the detectors
// once — it is NOT a live import of, or a re-run of, detector logic, and it
// does NOT prove which specific rule instance fired for an individual
// Observation (that data isn't persisted — see ARCHITECTURE.md §20 and the
// Observer Console v1.1 spec's "Rule Provenance" revision). `keywordSample`
// is explicitly a sample for orientation, never "the keyword that matched."
//
// Only imports server/intelligence/observation/types.ts (a Prisma-free,
// hand-written type module) — never a detector function itself.

import type { ObservationType } from "../intelligence/observation/types";

export interface DetectorDescriptor {
  detectorId: string;
  kind: "keyword" | "temporal";
  description: string;
  keywordSample?: string[];
}

export const DETECTOR_REGISTRY: Record<ObservationType, DetectorDescriptor> = {
  PRICE_REQUEST: {
    detectorId: "keyword.price_request",
    kind: "keyword",
    description:
      "Associated with a keyword/pattern detector (es/pt/en) that checks an inbound message's full text for price-related terms.",
    keywordSample: ["precio", "cuánto cuesta", "quanto custa", "price", "cost"],
  },
  DISCOUNT_NEGOTIATION: {
    detectorId: "keyword.discount_negotiation",
    kind: "keyword",
    description:
      "Associated with a keyword/pattern detector (es/pt/en) checked independently from PRICE_REQUEST — a message can match both.",
    keywordSample: ["descuento", "desconto", "discount", "rebaja", "oferta"],
  },
  COMPATIBILITY_QUESTION: {
    detectorId: "keyword.compatibility_question",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for whether a product fits/works with something.",
    keywordSample: ["compatible", "funciona con", "sirve para", "serve para"],
  },
  INSTALLATION_QUESTION: {
    detectorId: "keyword.installation_question",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for installation-related questions.",
    keywordSample: ["instalar", "instalación", "installation", "montagem"],
  },
  PHOTO_REQUEST: {
    detectorId: "keyword.photo_request",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for requests to see a photo.",
    keywordSample: ["foto", "photo", "picture", "imagem"],
  },
  CUSTOMER_GHOSTED: {
    detectorId: "temporal.customer_ghosted",
    kind: "temporal",
    description:
      "Associated with a time-based (not keyword-based) detector with two distinct trigger paths: (a) a new inbound " +
      "message arriving 24h+ after a previous inbound message that the advisor never replied to, or (b) a conversation " +
      "closing 24h+ after the advisor's last message went unanswered. No exact elapsed time or matched threshold is " +
      "persisted — only the detector's own summary text, verbatim.",
  },
  QUOTE_REQUEST: {
    detectorId: "keyword.quote_request",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for requests for a formal quote.",
    keywordSample: ["cotización", "cotizar", "orçamento", "quote"],
  },
  AVAILABILITY_REQUEST: {
    detectorId: "keyword.availability_request",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for stock/availability questions.",
    keywordSample: ["tienen stock", "hay disponible", "em estoque", "available"],
  },
  DELIVERY_TIME_REQUEST: {
    detectorId: "keyword.delivery_time_request",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for delivery/installation timing questions.",
    keywordSample: ["en que tiempo", "cuanto demora", "tempo de entrega", "how long"],
  },
  PAYMENT_METHOD_REQUEST: {
    detectorId: "keyword.payment_method_request",
    kind: "keyword",
    description:
      "Associated with a keyword/pattern detector (es/pt/en) for how-to-pay questions — an event, distinct from the " +
      "mutable AWAITING_PAYMENT/PAYMENT_CONFIRMED state server/intelligence/lead-commercial-state/extractors/payment-extractor.ts tracks.",
    keywordSample: ["como pago", "yape", "plin", "formas de pago"],
  },
  PRICE_OBJECTION: {
    detectorId: "keyword.price_objection",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for the customer objecting to price — distinct from a neutral PRICE_REQUEST.",
    keywordSample: ["muy caro", "no me alcanza", "más barato", "too expensive"],
  },
  AVAILABILITY_FRICTION: {
    detectorId: "keyword.availability_friction",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for the customer hitting an out-of-stock/unavailable obstacle.",
    keywordSample: ["no hay stock", "agotado", "sem estoque", "out of stock"],
  },
  DELIVERY_LOCATION_FRICTION: {
    detectorId: "keyword.delivery_location_friction",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for the customer being told Koriaki doesn't deliver to their area.",
    keywordSample: ["no llegan", "no hacen envios", "não entregam", "don't deliver"],
  },
  INSTALLATION_FRICTION: {
    detectorId: "keyword.installation_friction",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for installation not being available/offered.",
    keywordSample: ["no instalan", "não instalam", "don't install"],
  },
  TRUST_FRICTION: {
    detectorId: "keyword.trust_friction",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for the customer questioning legitimacy/trust.",
    keywordSample: ["es seguro", "es confiable", "estafa", "scam"],
  },
  TIMING_FRICTION: {
    detectorId: "keyword.timing_friction",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector (es/pt/en) for the customer complaining about slowness.",
    keywordSample: ["muy lento", "mucho tiempo", "too slow"],
  },
  LIMA_MENTIONED: {
    detectorId: "keyword.lima_mentioned",
    kind: "keyword",
    description:
      "Associated with a keyword/pattern detector for a Lima/Lima-district mention — a coarse presence signal for demand-by-region " +
      "reporting, distinct from the canonical resolved deliveryLocation fact (server/intelligence/lead-commercial-state/extractors/location-extractor.ts).",
    keywordSample: ["Lima", "Miraflores", "Surco", "Callao"],
  },
  PROVINCE_MENTIONED: {
    detectorId: "keyword.province_mentioned",
    kind: "keyword",
    description: "Associated with a keyword/pattern detector for a province/region-outside-Lima mention — same coarse-signal role as LIMA_MENTIONED.",
    keywordSample: ["provincia", "Ayacucho", "Cusco", "Arequipa"],
  },
};
