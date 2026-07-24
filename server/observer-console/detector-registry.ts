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
};
