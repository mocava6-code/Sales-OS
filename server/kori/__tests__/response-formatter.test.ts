import { describe, expect, it } from "vitest";
import { resolveKoriDateToken } from "../date-interpretation";
import { formatKoriResponse } from "../response-formatter";
import type { KoriQueryResult, KoriQuerySpec } from "../query-spec";

const NOW = new Date("2026-08-06T15:30:00.000Z"); // Thursday, America/Lima local 10:30
const TZ = "America/Lima";
const CONTEXT = { now: NOW, timezone: TZ };

function spec(overrides: Partial<KoriQuerySpec>): KoriQuerySpec {
  return { operation: "COUNT_LEADS", limit: 25, ...overrides };
}

describe("formatKoriResponse — COUNT_LEADS", () => {
  it("phrases a needsReply count exactly as specified", () => {
    const result: KoriQueryResult = { type: "count", count: 7 };
    const formatted = formatKoriResponse(spec({ operation: "COUNT_LEADS", filters: { needsReply: true } }), result, CONTEXT);
    expect(formatted.answer).toBe("Hay 7 clientes que necesitan respuesta.");
    expect(formatted.type).toBe("count");
    if (formatted.type === "count") expect(formatted.count).toBe(7);
  });

  it("uses singular 'cliente' for count=1", () => {
    const result: KoriQueryResult = { type: "count", count: 1 };
    const formatted = formatKoriResponse(spec({ operation: "COUNT_LEADS" }), result, CONTEXT);
    expect(formatted.answer).toBe("Hay 1 cliente.");
  });

  it("has no trailing clause when there are no notable filters", () => {
    const result: KoriQueryResult = { type: "count", count: 3 };
    const formatted = formatKoriResponse(spec({ operation: "COUNT_LEADS" }), result, CONTEXT);
    expect(formatted.answer).toBe("Hay 3 clientes.");
  });
});

describe("formatKoriResponse — LIST_LEADS", () => {
  it("combines brand + needsReply exactly as specified", () => {
    const result: KoriQueryResult = { type: "lead_list", count: 4, rows: [] };
    const formatted = formatKoriResponse(
      spec({ operation: "LIST_LEADS", filters: { vehicleBrand: "Toyota", needsReply: true } }),
      result,
      CONTEXT,
    );
    expect(formatted.answer).toBe("Hay 4 clientes Toyota que necesitan respuesta.");
    if (formatted.type === "lead_list") expect(formatted.rows).toEqual([]);
  });

  it("phrases wholesale customerType as 'mayoristas'", () => {
    const result: KoriQueryResult = { type: "lead_list", count: 2, rows: [] };
    const formatted = formatKoriResponse(
      spec({ operation: "LIST_LEADS", filters: { vehicleBrand: "Toyota", customerType: "WHOLESALE" } }),
      result,
      CONTEXT,
    );
    expect(formatted.answer).toBe("Hay 2 clientes Toyota mayoristas.");
  });
});

describe("formatKoriResponse — GROUP_LEADS", () => {
  it("phrases groups as 'Key: count, Key: count.'", () => {
    const result: KoriQueryResult = {
      type: "grouped_result",
      groups: [
        { key: "Toyota", count: 12 },
        { key: "Ford", count: 7 },
      ],
    };
    const formatted = formatKoriResponse(spec({ operation: "GROUP_LEADS", groupBy: "vehicleBrand" }), result, CONTEXT);
    expect(formatted.answer).toBe("Toyota: 12, Ford: 7.");
    if (formatted.type === "grouped_result") expect(formatted.groups).toHaveLength(2);
  });

  it("handles an empty group result gracefully", () => {
    const result: KoriQueryResult = { type: "grouped_result", groups: [] };
    const formatted = formatKoriResponse(spec({ operation: "GROUP_LEADS", groupBy: "vehicleBrand" }), result, CONTEXT);
    expect(formatted.answer).toBe("No se encontraron resultados para agrupar.");
  });
});

describe("formatKoriResponse — PRODUCT_RANKING", () => {
  it("phrases the ranking with counts in parentheses, and states the implicit last-30-days window (matches the dashboard's own default — query-executor.ts's executeProductRanking)", () => {
    const result: KoriQueryResult = {
      type: "grouped_result",
      groups: [
        { key: "TRAVO body kit", count: 12 },
        { key: "Paragolpes", count: 7 },
      ],
    };
    const formatted = formatKoriResponse(spec({ operation: "PRODUCT_RANKING" }), result, CONTEXT);
    expect(formatted.answer).toBe("Los productos más consultados en los últimos 30 días son: TRAVO body kit (12), Paragolpes (7).");
  });

  it("uses the recognized date-range phrase instead of 'últimos 30 días' when the caller specified one explicitly", () => {
    const result: KoriQueryResult = { type: "grouped_result", groups: [{ key: "TRAVO", count: 5 }] };
    const thisMonthStart = resolveKoriDateToken("THIS_MONTH_START", NOW, TZ);
    const formatted = formatKoriResponse(spec({ operation: "PRODUCT_RANKING", filters: { createdFrom: thisMonthStart } }), result, CONTEXT);
    expect(formatted.answer).toBe("Los productos más consultados este mes son: TRAVO (5).");
  });

  it("adds an honest caveat naming how many clients have no product identified, without presenting them as classified", () => {
    const result: KoriQueryResult = {
      type: "grouped_result",
      groups: [
        { key: "kit", count: 9 },
        { key: "accesorios", count: 1 },
        { key: "Sin información", count: 40 },
      ],
    };
    const formatted = formatKoriResponse(spec({ operation: "PRODUCT_RANKING" }), result, CONTEXT);
    expect(formatted.answer).toBe(
      "Los productos más consultados en los últimos 30 días son: kit (9), accesorios (1). " +
        "40 de 50 clientes todavía no tienen un producto identificado — este ranking solo refleja los casos clasificados.",
    );
  });

  it("omits the caveat entirely when every lead in range has a classified product", () => {
    const result: KoriQueryResult = { type: "grouped_result", groups: [{ key: "kit", count: 3 }] };
    const formatted = formatKoriResponse(spec({ operation: "PRODUCT_RANKING" }), result, CONTEXT);
    expect(formatted.answer).not.toContain("todavía no tienen");
  });

  it("never claims a ranking exists when every lead in range is unclassified", () => {
    const result: KoriQueryResult = { type: "grouped_result", groups: [{ key: "Sin información", count: 12 }] };
    const formatted = formatKoriResponse(spec({ operation: "PRODUCT_RANKING" }), result, CONTEXT);
    expect(formatted.answer).toBe("Todavía no hay productos identificados en los últimos 30 días — 12 clientes no tienen un producto de interés registrado.");
    expect(formatted.answer).not.toContain("Los productos más consultados");
  });
});

describe("formatKoriResponse — FOLLOW_UP_QUEUE", () => {
  it("phrases pending follow-ups exactly as specified", () => {
    const result: KoriQueryResult = { type: "lead_list", count: 5, rows: [] };
    const formatted = formatKoriResponse(spec({ operation: "FOLLOW_UP_QUEUE" }), result, CONTEXT);
    expect(formatted.answer).toBe("Hay 5 seguimientos pendientes.");
  });

  it("uses singular phrasing for count=1", () => {
    const result: KoriQueryResult = { type: "lead_list", count: 1, rows: [] };
    const formatted = formatKoriResponse(spec({ operation: "FOLLOW_UP_QUEUE" }), result, CONTEXT);
    expect(formatted.answer).toBe("Hay 1 seguimiento pendiente.");
  });
});

describe("formatKoriResponse — COUNT_OUTCOMES", () => {
  it("phrases QUOTATION_SENT + this-week date range exactly as specified", () => {
    const result: KoriQueryResult = { type: "count", count: 8 };
    const formatted = formatKoriResponse(
      spec({ operation: "COUNT_OUTCOMES", filters: { outcomeType: "QUOTATION_SENT", createdFrom: "2026-08-03T05:00:00.000Z" } }),
      result,
      CONTEXT,
    );
    expect(formatted.answer).toBe("Se enviaron 8 cotizaciones esta semana.");
  });

  it("falls back to a generic phrase for an unrecognized date range (no exact token match)", () => {
    const result: KoriQueryResult = { type: "count", count: 3 };
    const formatted = formatKoriResponse(
      spec({ operation: "COUNT_OUTCOMES", filters: { outcomeType: "SALE_CLOSED", createdFrom: "2020-01-01T00:00:00.000Z" } }),
      result,
      CONTEXT,
    );
    expect(formatted.answer).toBe("Se cerraron 3 ventas.");
  });

  it("falls back to a fully generic phrase with no outcomeType filter", () => {
    const result: KoriQueryResult = { type: "count", count: 0 };
    const formatted = formatKoriResponse(spec({ operation: "COUNT_OUTCOMES" }), result, CONTEXT);
    expect(formatted.answer).toBe("Se registraron 0 resultados.");
  });
});
