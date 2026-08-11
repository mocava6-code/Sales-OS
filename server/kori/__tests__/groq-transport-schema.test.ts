import { describe, expect, it } from "vitest";
import { parseKoriQuerySpec } from "../query-spec";
import { UnsupportedKoriQuestionError } from "../errors";
import { buildKoriGroqTransportJsonSchema, transportToKoriQuerySpecJson } from "../groq-transport-schema";

// Regression coverage for two real production Groq failures against
// openai/gpt-oss-20b's strict json_schema mode:
//
// 1. A 400 at schema-validation time because `filters`/`sort` declared
//    properties that weren't also listed in `required` (sanitized Groq
//    error body: "/properties/sort/required missing: direction, field",
//    "/properties/filters/required missing all filter properties").
// 2. A generation-time failure ("'/sort' expected object, but got null")
//    once the schema itself validated but the model legitimately had no
//    sort to express — `sort` was declared as a plain `type: "object"`,
//    which forbids `null` outright. Fixed with `anyOf: [<object>, {type:
//    "null"}]`, the documented way to make an object nullable in strict
//    structured outputs.
//
// These tests assert both rules — required-lists-every-property, and
// optional NESTED OBJECTS specifically (not just their scalar fields) are
// null-representable — at every level of the schema, so neither can
// regress silently.

interface SchemaObjectNode {
  path: string;
  node: { type?: unknown; properties?: Record<string, unknown>; required?: unknown; additionalProperties?: unknown };
}

/** Walks `properties` at every level, descending into `anyOf` branches too (that's where a nullable object's real shape lives). */
function collectObjectNodes(node: unknown, path: string, acc: SchemaObjectNode[] = []): SchemaObjectNode[] {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return acc;
  }
  const typed = node as SchemaObjectNode["node"] & { anyOf?: unknown[] };

  if (typed.type === "object" && typed.properties) {
    acc.push({ path, node: typed });
    for (const [key, child] of Object.entries(typed.properties)) {
      collectObjectNodes(child, `${path}.${key}`, acc);
    }
  }

  if (Array.isArray(typed.anyOf)) {
    typed.anyOf.forEach((branch, i) => collectObjectNodes(branch, `${path}[anyOf:${i}]`, acc));
  }

  return acc;
}

function findSchemaNode(node: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[key];
  }, node);
}

describe("buildKoriGroqTransportJsonSchema — Groq strict json_schema compliance", () => {
  const groqSchema = buildKoriGroqTransportJsonSchema();
  const objectNodes = collectObjectNodes(groqSchema.schema, "root");

  it("finds the root, filters, and sort's anyOf object-branch nodes (sanity check that the walk actually covers the schema)", () => {
    expect(objectNodes.map((n) => n.path)).toEqual(["root", "root.filters", "root.sort[anyOf:0]"]);
  });

  it.each(objectNodes.map((n) => [n.path, n] as const))("%s has additionalProperties: false", (_path, { node }) => {
    expect(node.additionalProperties).toBe(false);
  });

  it.each(objectNodes.map((n) => [n.path, n] as const))(
    "%s lists every declared property in `required` — the rule the first production 400 violated",
    (_path, { node }) => {
      const propertyKeys = Object.keys(node.properties ?? {});
      expect(Array.isArray(node.required)).toBe(true);
      expect(new Set(node.required as string[])).toEqual(new Set(propertyKeys));
    },
  );

  it("marks every optional property as nullable: scalars via a `null` type/enum member, nested objects (sort) via an anyOf null branch", () => {
    for (const { path, node } of objectNodes) {
      for (const [key, rawChild] of Object.entries(node.properties ?? {})) {
        const child = rawChild as { type?: unknown; enum?: unknown[]; anyOf?: unknown[] };
        if (path === "root" && key === "unsupported") continue; // the one genuinely non-nullable field

        if (Array.isArray(child.anyOf)) {
          const hasNullBranch = child.anyOf.some((b) => typeof b === "object" && b !== null && (b as { type?: unknown }).type === "null");
          expect(hasNullBranch, `${path}.${key}'s anyOf should include a {type: "null"} branch`).toBe(true);
          continue;
        }
        if (child.type === "object") continue; // filters: always-present container by design (not nullable itself, per audit — only its own properties are)
        expect(Array.isArray(child.type) && (child.type as string[]).includes("null"), `${path}.${key} should be nullable`).toBe(true);
        if (Array.isArray(child.enum)) {
          expect(child.enum, `${path}.${key} enum should include null`).toContain(null);
        }
      }
    }
  });

  it("sort is nullable via anyOf: [<object schema>, {type: 'null'}] — the second production failure ('/sort' expected object, but got null)", () => {
    const sortNode = findSchemaNode(groqSchema.schema, ["properties", "sort"]) as { anyOf?: unknown[] };
    expect(Array.isArray(sortNode.anyOf)).toBe(true);
    expect(sortNode.anyOf).toHaveLength(2);
    expect(sortNode.anyOf?.[1]).toEqual({ type: "null" });
    const objectBranch = sortNode.anyOf?.[0] as { type?: unknown; additionalProperties?: unknown; required?: unknown };
    expect(objectBranch.type).toBe("object");
    expect(objectBranch.additionalProperties).toBe(false);
    expect(objectBranch.required).toEqual(["field", "direction"]);
  });

  it("audit: filters is the only other nested object, and is deliberately NOT nullable (the prompt always sends it as an object) — confirms no other optional-nested-object gaps exist", () => {
    const filtersNode = findSchemaNode(groqSchema.schema, ["properties", "filters"]) as { type?: unknown; anyOf?: unknown };
    expect(filtersNode.type).toBe("object");
    expect(filtersNode.anyOf).toBeUndefined();
    // No nested object schema exists anywhere else in the tree besides filters/sort.
    const rootProperties = (groqSchema.schema as { properties: Record<string, unknown> }).properties;
    for (const [key, value] of Object.entries(rootProperties)) {
      if (key === "filters" || key === "sort") continue;
      expect(typeof value === "object" && value !== null && (value as { type?: unknown }).type === "object", `${key} unexpectedly nested-object`).toBe(
        false,
      );
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

  it("regression: the exact real production generation for '¿Cuántos clientes necesitan respuesta?' (sort literally null, not an object)", () => {
    const productionGeneration = {
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
      sort: null,
      limit: null,
    };

    const loose = transportToKoriQuerySpecJson(productionGeneration);
    expect(loose).toEqual({ operation: "COUNT_LEADS", filters: { needsReply: true } });

    const spec = parseKoriQuerySpec(loose);
    expect(spec.operation).toBe("COUNT_LEADS");
    expect(spec.filters).toEqual({ needsReply: true });
    expect(spec.sort).toBeUndefined();
  });
});
