// Kori Natural Language Parsing v0 — Groq strict json_schema transport.
//
// Confirmed against a real production 400 from Groq (openai/gpt-oss-20b,
// response_format: json_schema, strict: true): Groq's strict structured
// outputs require EVERY property declared in an object's `properties` to
// also appear in that object's `required` array, including nested objects
// — omitting a key from `required` (the natural way to model an "optional"
// field in plain JSON Schema) is itself the 400. KoriQuerySpec's `filters`
// and `sort` are both genuinely optional/partial by design (see
// query-spec.ts), so this module defines a SEPARATE, Groq-only transport
// shape where every field is always present and "optional" is represented
// as `type: [T, "null"]` instead — OpenAI's own documented pattern for
// strict structured outputs, which Groq mirrors for OpenAI-compatible
// models. transportToKoriQuerySpecJson() converts a parsed transport
// object back into the loose, nulls-stripped shape the rest of the
// pipeline (date-token resolution, normalization, parseKoriQuerySpec)
// already expects — none of those downstream stages change.
//
// parseKoriQuerySpec() remains the sole authority on what's actually a
// valid KoriQuerySpec: this module only reshapes JSON before validation,
// it never relaxes or duplicates that validation.

import {
  CUSTOMER_TYPE_FILTER_VALUES,
  KORI_GROUP_BY_FIELDS,
  KORI_QUERY_OPERATIONS,
  KORI_SORT_FIELDS,
  LEAD_PRIORITY_VALUES,
  LEAD_STATUS_VALUES,
  OUTCOME_TYPE_VALUES,
} from "./query-spec";
import { UnsupportedKoriQuestionError } from "./errors";
import type { GroqJsonSchema } from "./groq-client";

const NULLABLE_STRING = { type: ["string", "null"] } as const;
const NULLABLE_INTEGER = { type: ["integer", "null"] } as const;
const NULLABLE_BOOLEAN = { type: ["boolean", "null"] } as const;

/** A nullable enum: `null` must be listed explicitly in `enum` — the `type` union alone doesn't exempt it from the enum constraint. */
function nullableEnum(values: readonly string[]): { type: readonly ["string", "null"]; enum: (string | null)[] } {
  return { type: ["string", "null"], enum: [...values, null] };
}

const FILTERS_PROPERTIES = {
  vehicleBrand: NULLABLE_STRING,
  vehicleModel: NULLABLE_STRING,
  vehicleYear: NULLABLE_INTEGER,
  productInterest: NULLABLE_STRING,
  customerType: nullableEnum(CUSTOMER_TYPE_FILTER_VALUES),
  needsReply: NULLABLE_BOOLEAN,
  overdueFollowUp: NULLABLE_BOOLEAN,
  leadStatus: nullableEnum(LEAD_STATUS_VALUES),
  priority: nullableEnum(LEAD_PRIORITY_VALUES),
  assignedAgentId: NULLABLE_STRING,
  createdFrom: NULLABLE_STRING,
  createdTo: NULLABLE_STRING,
  lastActivityBefore: NULLABLE_STRING,
  lastActivityAfter: NULLABLE_STRING,
  outcomeType: nullableEnum(OUTCOME_TYPE_VALUES),
} as const;

const SORT_PROPERTIES = {
  field: nullableEnum(KORI_SORT_FIELDS),
  direction: { type: ["string", "null"], enum: ["asc", "desc", null] },
} as const;

// `sort` is a genuinely optional NESTED OBJECT (KoriQuerySpec's sort is
// `.optional()`, unlike `filters` which the prompt always populates as an
// object even when every filter is unused — see FILTERS_PROPERTIES above,
// left as a plain always-present object per that distinction). A plain
// `type: "object"` declaration forces the model to always emit an object
// and rejects `null` — confirmed against a real production generation
// failure ("'/sort' expected object, but got null") once the model
// legitimately had nothing to sort by. A bare `type: ["object", "null"]`
// alongside object-only keywords (properties/required/additionalProperties)
// is ambiguous for strict-mode compilers; `anyOf` with an explicit
// `{type: "null"}` branch is the documented, unambiguous way to make an
// object nullable in OpenAI-compatible strict structured outputs, which
// Groq mirrors for openai/gpt-oss models. If any other nested object is
// ever added to this schema and is similarly optional, it must use this
// same anyOf-with-null-branch shape, not a plain "object" type.
const NULLABLE_SORT_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: SORT_PROPERTIES,
      required: Object.keys(SORT_PROPERTIES),
      additionalProperties: false,
    },
    { type: "null" },
  ],
};

/**
 * The schema sent to Groq in response_format: {type: "json_schema", ...,
 * strict: true}. Every object has additionalProperties: false; every key
 * in `properties` is also in `required`, at every nesting level — the
 * exact two rules Groq's strict mode enforces server-side.
 */
export function buildKoriGroqTransportJsonSchema(): GroqJsonSchema {
  return {
    name: "kori_query_spec",
    schema: {
      type: "object",
      properties: {
        unsupported: { type: "boolean" },
        operation: nullableEnum(KORI_QUERY_OPERATIONS),
        filters: {
          type: "object",
          properties: FILTERS_PROPERTIES,
          required: Object.keys(FILTERS_PROPERTIES),
          additionalProperties: false,
        },
        groupBy: nullableEnum(KORI_GROUP_BY_FIELDS),
        sort: NULLABLE_SORT_SCHEMA,
        limit: NULLABLE_INTEGER,
      },
      required: ["unsupported", "operation", "filters", "groupBy", "sort", "limit"],
      additionalProperties: false,
    },
  };
}

function stripNulls(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

const NULLABLE_TOP_LEVEL_SCALAR_FIELDS = ["operation", "groupBy", "limit"] as const;

/**
 * Converts a parsed Groq transport object (every field present, optional
 * ones nulled) into the loose JSON shape resolveDateTokensInQueryJson /
 * normalizeFreeTextFiltersInQueryJson / parseKoriQuerySpec already expect:
 * null fields dropped, empty/incomplete filters/sort objects omitted
 * entirely. Deliberately starts from a full copy of the input object
 * (`{...obj}`), not a fixed whitelist of known keys — an unexpected key
 * Groq (or a compromised/buggy transport) produces, e.g. a smuggled
 * `businessId`, is preserved rather than silently dropped, so
 * parseKoriQuerySpec's `.strict()` schema still rejects it downstream. This
 * function only reshapes the known transport fields; it never widens what
 * ultimately reaches validation.
 *
 * Safe to run unconditionally regardless of which Groq response_format
 * mode produced the JSON: on an already-loose json_object response (no
 * nulls, optional keys simply absent), every strip/delete here is a
 * no-op.
 *
 * Throws UnsupportedKoriQuestionError immediately when Groq's `unsupported`
 * sentinel is true — never attempts to build a spec from the rest of the
 * object in that case.
 */
export function transportToKoriQuerySpecJson(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const obj = raw as Record<string, unknown>;

  if (obj.unsupported === true) {
    throw new UnsupportedKoriQuestionError("This question is not supported by Kori's query engine yet.");
  }

  const result: Record<string, unknown> = { ...obj };
  delete result.unsupported;

  // groupBy/limit are `.optional()` (not `.nullable()`) in koriQuerySpecSchema
  // — an explicit `null` (Groq's normal transport value whenever the field
  // doesn't apply) would fail validation as-is, so it must be deleted, not
  // just left in place. operation has no default at all if missing, which
  // correctly fails validation the same way a literal null would.
  for (const field of NULLABLE_TOP_LEVEL_SCALAR_FIELDS) {
    if (result[field] === null) {
      delete result[field];
    }
  }

  if (result.filters === null) {
    delete result.filters;
  } else if (typeof result.filters === "object" && !Array.isArray(result.filters)) {
    const strippedFilters = stripNulls(result.filters as Record<string, unknown>);
    if (Object.keys(strippedFilters).length > 0) {
      result.filters = strippedFilters;
    } else {
      delete result.filters;
    }
  }

  if (result.sort === null) {
    delete result.sort;
  } else if (typeof result.sort === "object" && !Array.isArray(result.sort)) {
    const strippedSort = stripNulls(result.sort as Record<string, unknown>);
    // A sort value is only meaningful with BOTH field and direction — if
    // null-stripping leaves just one, it's not a valid koriQuerySortSchema
    // shape, so drop it rather than forward a half-formed object.
    if (typeof strippedSort.field === "string" && typeof strippedSort.direction === "string") {
      result.sort = strippedSort;
    } else {
      delete result.sort;
    }
  }

  return result;
}
