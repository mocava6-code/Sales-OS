// Deterministic, explicit-lookup-table normalization for common Koriaki
// terminology — never fuzzy matching. Same discipline as
// server/intelligence/lead-commercial-state/extractors/freetext-product-extractor.ts's
// KNOWN_VEHICLE_MODELS/KNOWN_PRODUCT_LINES: a static Record<string,string>,
// keyed by a normalized (lowercase, accent-stripped) form. Unrecognized
// input is returned unchanged — never guessed — so a caller (the query
// executor today, a future Groq-based NL layer later) can still fall back
// to an exact/case-insensitive match against whatever's actually stored.

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks left by NFD decomposition
    .trim()
    .toLowerCase();
}

// Vehicle brands Koriaki actually sells — extend deliberately, one entry at
// a time, never algorithmically.
const KNOWN_VEHICLE_BRANDS: Record<string, string> = {
  toyota: "Toyota",
  ford: "Ford",
};

/** Case/accent-insensitive brand canonicalization. Unrecognized input passed through unchanged (trimmed only). */
export function normalizeVehicleBrand(input: string): string {
  const trimmed = input.trim();
  return KNOWN_VEHICLE_BRANDS[normalizeKey(trimmed)] ?? trimmed;
}

// Vehicle models Kori's deterministic extractor already recognizes when
// reading conversation text — see freetext-product-extractor.ts's
// KNOWN_VEHICLE_MODELS. Kept as a SEPARATE table here (query-time
// normalization) rather than importing that module's, since this table is
// about matching a QUERY FILTER value against whatever's already stored,
// not about extracting new fact from a message — the two lists happening
// to overlap today doesn't mean they must always stay coupled.
const KNOWN_VEHICLE_MODELS: Record<string, string> = {
  hilux: "Hilux",
  fortuner: "Fortuner",
  corolla: "Corolla",
  hiace: "Hiace",
  yaris: "Yaris",
  rav4: "RAV4",
  "land cruiser": "Land Cruiser",
  ranger: "Ranger",
};

/**
 * Case/accent-insensitive model canonicalization. NOTE: normalizing a
 * filter value to "Ranger" does not guarantee any lead is actually tagged
 * vehicleModel="Ranger" — the deterministic extractor that populates
 * LeadCommercialProfile doesn't recognize "Ranger" as of this phase (see
 * KNOWN_VEHICLE_MODELS in freetext-product-extractor.ts). Extending that
 * extractor's vocabulary is a separate change.
 */
export function normalizeVehicleModel(input: string): string {
  const trimmed = input.trim();
  return KNOWN_VEHICLE_MODELS[normalizeKey(trimmed)] ?? trimmed;
}

const CUSTOMER_TYPE_TERMS: Record<string, "RETAIL" | "WHOLESALE"> = {
  b2b: "WHOLESALE",
  mayorista: "WHOLESALE",
  distribuidor: "WHOLESALE",
  taller: "WHOLESALE",
  b2c: "RETAIL",
  "cliente final": "RETAIL",
  particular: "RETAIL",
};

/**
 * String -> CustomerType term normalization, exported for a future
 * Groq-based NL layer to canonicalize free-text extraction before building
 * a KoriQuerySpec (whose `filters.customerType` is already a strict
 * RETAIL|WHOLESALE enum, so the executor itself never needs this). Returns
 * null for unrecognized input — never guessed.
 */
export function normalizeCustomerTypeTerm(input: string): "RETAIL" | "WHOLESALE" | null {
  return CUSTOMER_TYPE_TERMS[normalizeKey(input)] ?? null;
}
