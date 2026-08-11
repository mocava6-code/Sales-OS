// Kori End-to-End Query Execution v0 — STEP 2 (deterministic formatting).
//
// v0 deliberately does NOT call Groq (or any AI) a second time to phrase
// the answer — every sentence here is built from fixed Spanish templates
// plus the querySpec's own filter values. This is the whole reason the
// output is trustworthy: a formatted "answer" can never say anything the
// structured result doesn't actually support, because it's built FROM that
// result, not generated freestyle. The raw KoriQueryResult (rows/groups/
// count) is preserved unmodified alongside `answer` so the UI can render
// cards/lists later without re-deriving anything.

import { resolveKoriDateToken, type KoriDateToken } from "./date-interpretation";
import type { KoriQueryResult, KoriQuerySpec } from "./query-spec";

export type KoriFormattedResponse = { answer: string } & KoriQueryResult;

export interface FormatKoriResponseContext {
  /** Same anchor instant used to resolve the querySpec's date filters — needed to recognize "esta semana" etc. by re-deriving the same tokens. */
  now: Date;
  timezone: string;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Builds a short adjective/qualifier clause from lead filters, e.g. "Toyota que necesitan respuesta". Empty string when no filter is notable enough to phrase. */
function describeLeadFilterClause(filters: KoriQuerySpec["filters"]): string {
  const adjectives: string[] = [];
  if (filters?.vehicleBrand) adjectives.push(filters.vehicleBrand);
  if (filters?.vehicleModel) adjectives.push(filters.vehicleModel);
  if (filters?.customerType === "WHOLESALE") adjectives.push("mayoristas");
  if (filters?.customerType === "RETAIL") adjectives.push("minoristas");

  const clauses: string[] = [];
  if (adjectives.length > 0) clauses.push(adjectives.join(" "));
  if (filters?.needsReply === true) clauses.push("que necesitan respuesta");
  if (filters?.needsReply === false) clauses.push("que no necesitan respuesta");
  if (filters?.overdueFollowUp === true) clauses.push("con seguimiento vencido");
  if (filters?.leadStatus) clauses.push(`en estado ${filters.leadStatus}`);
  if (filters?.priority) clauses.push(`de prioridad ${filters.priority}`);

  return clauses.join(" ");
}

// `plural` deliberately avoids repeating the verb's own participle (e.g.
// "Se enviaron cotizaciones", not "Se enviaron cotizaciones enviadas") —
// the two combine into one natural sentence, never a redundant one.
const OUTCOME_TYPE_PHRASING: Record<string, { plural: string; verb: string }> = {
  CUSTOMER_REPLIED: { plural: "respuestas de clientes", verb: "Se registraron" },
  MEETING_SCHEDULED: { plural: "reuniones", verb: "Se agendaron" },
  FOLLOW_UP_SENT: { plural: "seguimientos", verb: "Se enviaron" },
  QUOTATION_REQUESTED: { plural: "cotizaciones", verb: "Se solicitaron" },
  QUOTATION_SENT: { plural: "cotizaciones", verb: "Se enviaron" },
  SALE_CLOSED: { plural: "ventas", verb: "Se cerraron" },
  SALE_LOST: { plural: "ventas", verb: "Se perdieron" },
  ABANDONED: { plural: "conversaciones abandonadas", verb: "Se registraron" },
};

// Only the tokens that map to a short, natural Spanish phrase — the rest
// (e.g. LAST_24_HOURS_START) don't read naturally as a trailing clause, so
// a date filter that doesn't match one of these just omits the qualifier
// rather than forcing an awkward phrase.
const DATE_RANGE_LABELS: { token: KoriDateToken; label: string }[] = [
  { token: "TODAY_START", label: "hoy" },
  { token: "YESTERDAY_START", label: "ayer" },
  { token: "THIS_WEEK_START", label: "esta semana" },
  { token: "LAST_WEEK_START", label: "la semana pasada" },
  { token: "THIS_MONTH_START", label: "este mes" },
  { token: "LAST_MONTH_START", label: "el mes pasado" },
];

/** Recognizes a resolved createdFrom value as one of the known relative-date concepts, by re-resolving each token with the same now/timezone and comparing. */
function describeDateRangeLabel(createdFrom: string | undefined, context: FormatKoriResponseContext): string | null {
  if (!createdFrom) return null;
  for (const { token, label } of DATE_RANGE_LABELS) {
    if (resolveKoriDateToken(token, context.now, context.timezone) === createdFrom) {
      return label;
    }
  }
  return null;
}

class KoriFormatterInvariantError extends Error {
  constructor(operation: string, resultType: string) {
    super(`formatKoriResponse: operation ${operation} produced an unexpected result type ${resultType}. This indicates an executor/formatter mismatch, never a user-facing condition.`);
    this.name = "KoriFormatterInvariantError";
  }
}

function buildAnswer(spec: KoriQuerySpec, result: KoriQueryResult, context: FormatKoriResponseContext): string {
  switch (spec.operation) {
    case "COUNT_LEADS": {
      if (result.type !== "count") throw new KoriFormatterInvariantError(spec.operation, result.type);
      const clause = describeLeadFilterClause(spec.filters);
      return `Hay ${result.count} ${pluralize(result.count, "cliente", "clientes")}${clause ? ` ${clause}` : ""}.`;
    }
    case "LIST_LEADS": {
      if (result.type !== "lead_list") throw new KoriFormatterInvariantError(spec.operation, result.type);
      const clause = describeLeadFilterClause(spec.filters);
      return `Hay ${result.count} ${pluralize(result.count, "cliente", "clientes")}${clause ? ` ${clause}` : ""}.`;
    }
    case "GROUP_LEADS": {
      if (result.type !== "grouped_result") throw new KoriFormatterInvariantError(spec.operation, result.type);
      if (result.groups.length === 0) return "No se encontraron resultados para agrupar.";
      return `${result.groups.map((g) => `${g.key}: ${g.count}`).join(", ")}.`;
    }
    case "PRODUCT_RANKING": {
      if (result.type !== "grouped_result") throw new KoriFormatterInvariantError(spec.operation, result.type);
      if (result.groups.length === 0) return "No se encontraron productos consultados.";
      return `Los productos más consultados son: ${result.groups.map((g) => `${g.key} (${g.count})`).join(", ")}.`;
    }
    case "FOLLOW_UP_QUEUE": {
      if (result.type !== "lead_list") throw new KoriFormatterInvariantError(spec.operation, result.type);
      return `Hay ${result.count} ${pluralize(result.count, "seguimiento pendiente", "seguimientos pendientes")}.`;
    }
    case "COUNT_OUTCOMES": {
      if (result.type !== "count") throw new KoriFormatterInvariantError(spec.operation, result.type);
      const outcomePhrasing = spec.filters?.outcomeType ? OUTCOME_TYPE_PHRASING[spec.filters.outcomeType] : undefined;
      const dateLabel = describeDateRangeLabel(spec.filters?.createdFrom, context);
      const suffix = dateLabel ? ` ${dateLabel}` : "";
      if (outcomePhrasing) {
        return `${outcomePhrasing.verb} ${result.count} ${outcomePhrasing.plural}${suffix}.`;
      }
      return `Se registraron ${result.count} ${pluralize(result.count, "resultado", "resultados")}${suffix}.`;
    }
  }
}

/**
 * Turns a validated KoriQuerySpec + its raw executeKoriQuery result into a
 * user-facing response: a deterministic Spanish `answer` sentence, plus the
 * unmodified raw result fields (type + count/rows/groups) for the UI.
 */
export function formatKoriResponse(spec: KoriQuerySpec, result: KoriQueryResult, context: FormatKoriResponseContext): KoriFormattedResponse {
  return { answer: buildAnswer(spec, result, context), ...result };
}
