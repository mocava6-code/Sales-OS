import { describe, expect, it } from "vitest";
import { parseKoriQuerySpec } from "../query-spec";
import { UnsupportedKoriQuestionError } from "../errors";
import { buildKoriGroqTransportJsonSchema, transportToKoriQuerySpecJson } from "../groq-transport-schema";

// Regression coverage for a real production Groq 400: openai/gpt-oss-20b's
// strict json_schema mode rejected the previous schema because `filters`
// and `sort` declared properties that weren't also listed in `required`
// (confirmed via the sanitized Groq error body: "/properties/sort/required
// missing: direction, field", "/properties/filters/required missing all
// filter properties"). These tests assert the two rules Groq's strict mode
// actually enforces, at every nesting level, so this can't regress silently.

interface SchemaObjectNode {
  path: string;
  node: { type?: unknown; properties?: Record<string, unknown>; required?: unknown; additionalProperties?: unknown };
}

function collectObjectNodes(node: unknown, path: string, acc: SchemaObjectNode[] = []): SchemaObjectNode[] {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return acc;
  }
  const typed = node as SchemaObjectNode["node"];
  if (typed.type === "object" && typed.properties) {
    acc.push({ path, node: typed });
    for (const [key, child] of Object.entries(typed.properties)) {
      collectObjectNodes(child, `${path}.${key}`, acc);
    }
  }
  return acc;
}

describe("buildKoriGroqTransportJsonSchema — Groq strict json_schema compliance", () => {
  const groqSchema = buildKoriGroqTransportJsonSchema();
  const objectNodes = collectObjectNodes(groqSchema.schema, "root");

  it("finds the root, filters, and sort object nodes (sanity check that the walk actually covers the schema)", () => {
    expect(objectNodes.map((n) => n.path)).toEqual(["root", "root.filters", "root.sort"]);
  });

  it.each(objectNodes.map((n) => [n.path, n] as const))("%s has additionalProperties: false", (_path, { node }) => {
    expect(node.additionalProperties).toBe(false);
  });

  it.each(objectNodes.map((n) => [n.path, n] as const))(
    "%s lists every declared property in `required` — the exact rule the production 400 violated",
    (_path, { node }) => {
      const propertyKeys = Object.keys(node.properties ?? {});
      expect(Array.isArray(node.required)).toBe(true);
      expect(new Set(node.required as string[])).toEqual(new Set(propertyKeys));
    },
  );

  it("marks every property other than `unsupported` as nullable (type includes null, enum includes null if present)", () => {
    for (const { path, node } of objectNodes) {
      for (const [key, rawChild] of Object.entries(node.properties ?? {})) {
        const child = rawChild as { type?: unknown; enum?: unknown[] };
        if (path === "root" && key === "unsupported") continue; // the one genuinely non-nullable field
        if (child.type === "object") continue; // nested objects (filters/sort) are always-present containers, not nullable themselves
        expect(Array.isArray(child.type) && (child.type as string[]).includes("null"), `${path}.${key} should be nullable`).toBe(true);
        if (Array.isArray(child.enum)) {
          expect(child.enum, `${path}.${key} enum should include null`).toContain(null);
        }
      }
    }
  });

  it("never declares businessId (or any tenant identifier) anywhere in the schema", () => {
    expect(JSON.stringify(groqSchema.schema)).not.toMatch(/business/i);
  });
});

describe("transportToKoriQuerySpecJson", () => {
  it("throws UnsupportedKoriQuestionError when unsupported=true, ignoring the rest of the object", () => {
    expect(() =>
      transportToKoriQuerySpecJson({
        unsupported: true,
        operation: null,
        filters: {},
        groupBy: null,
        sort: { field: null, direction: null },
        limit: null,
      }),
    ).toThrow(UnsupportedKoriQuestionError);
  });

  it("converts a fully-populated transport object (all filters null) into a valid, minimal KoriQuerySpec", () => {
    const transport = {
      unsupported: false,
      operation: "COUNT_LEADS",
      filters: {
        vehicleBrand: null,
        vehicleModel: null,
        vehicleYear: null,
        productInterest: null,
        customerType: null,
        needsReply: true,
        overdueFollowUp: null,
        leadStatus: null,
        priority: null,
        assignedAgentId: null,
        createdFrom: null,
        createdTo: null,
        lastActivityBefore: null,
        lastActivityAfter: null,
        outcomeType: null,
      },
      groupBy: null,
      sort: { field: null, direction: null },
      limit: null,
    };

    const loose = transportToKoriQuerySpecJson(transport);
    expect(loose).toEqual({ operation: "COUNT_LEADS", filters: { needsReply: true } });

    const spec = parseKoriQuerySpec(loose);
    expect(spec.operation).toBe("COUNT_LEADS");
    expect(spec.filters?.needsReply).toBe(true);
  });

  it("drops sort entirely when only one of field/direction survives null-stripping", () => {
    const loose = transportToKoriQuerySpecJson({
      unsupported: false,
      operation: "LIST_LEADS",
      filters: {},
      groupBy: null,
      sort: { field: "createdAt", direction: null },
      limit: null,
    }) as Record<string, unknown>;
    expect(loose.sort).toBeUndefined();
  });

  it("keeps a fully-populated sort", () => {
    const loose = transportToKoriQuerySpecJson({
      unsupported: false,
      operation: "LIST_LEADS",
      filters: {},
      groupBy: null,
      sort: { field: "createdAt", direction: "desc" },
      limit: 10,
    });
    expect(loose).toEqual({ operation: "LIST_LEADS", sort: { field: "createdAt", direction: "desc" }, limit: 10 });
  });

  it("preserves a smuggled top-level businessId instead of silently dropping it — parseKoriQuerySpec must still be the one to reject it", () => {
    const loose = transportToKoriQuerySpecJson({
      unsupported: false,
      operation: "COUNT_LEADS",
      businessId: "biz-1",
      filters: {},
      groupBy: null,
      sort: { field: null, direction: null },
      limit: null,
    }) as Record<string, unknown>;
    expect(loose.businessId).toBe("biz-1");
    expect(() => parseKoriQuerySpec(loose)).toThrow();
  });

  it("preserves a smuggled businessId nested inside filters the same way", () => {
    const loose = transportToKoriQuerySpecJson({
      unsupported: false,
      operation: "COUNT_LEADS",
      filters: { businessId: "biz-1", needsReply: null },
      groupBy: null,
      sort: { field: null, direction: null },
      limit: null,
    }) as Record<string, unknown>;
    expect((loose.filters as Record<string, unknown>).businessId).toBe("biz-1");
    expect(() => parseKoriQuerySpec(loose)).toThrow();
  });

  it("passes an already-loose (non-transport) object through unchanged, aside from stripping any nulls", () => {
    const loose = transportToKoriQuerySpecJson({ operation: "PRODUCT_RANKING" });
    expect(loose).toEqual({ operation: "PRODUCT_RANKING" });
  });

  it("passes through non-object input unchanged", () => {
    expect(transportToKoriQuerySpecJson(null)).toBeNull();
    expect(transportToKoriQuerySpecJson("not an object")).toBe("not an object");
  });
});
