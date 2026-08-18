// Gated: proves PrismaKnowledgeSource — the first real implementation of
// server/intelligence/knowledge-source.ts's KnowledgeSource seam — against
// real Postgres. Deliberately exercises tenant isolation, ACTIVE/expiry
// filtering, and the kind->category mapping, since those are the parts a
// mocked unit test can't meaningfully prove.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaKnowledgeSource } from "../prisma-knowledge-source";
import { createTestFixture, cleanupTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "../../__tests__/test-db";
import type { KnowledgeCategory } from "../../../db/generated/client";

type Db = ReturnType<typeof getTestPrisma>;

describe.skipIf(!shouldRunDbTests)("PrismaKnowledgeSource — against real Postgres", () => {
  let db: Db;
  let fixture: TestFixture;
  let source: PrismaKnowledgeSource;

  beforeEach(async () => {
    db = getTestPrisma();
    fixture = await createTestFixture(db, "knowledge-source");
    source = new PrismaKnowledgeSource(db);
  });

  afterEach(async () => {
    await db.knowledgeItem.deleteMany({ where: { businessId: fixture.businessId } });
    await cleanupTestFixture(db, fixture);
  });

  async function createItem(overrides: {
    title: string;
    content: string;
    category: KnowledgeCategory;
    tags: string[];
    status?: "ACTIVE" | "SUPERSEDED" | "ARCHIVED";
    expiresAt?: Date | null;
    businessId?: string;
  }) {
    return db.knowledgeItem.create({
      data: {
        businessId: overrides.businessId ?? fixture.businessId,
        title: overrides.title,
        content: overrides.content,
        category: overrides.category,
        tags: overrides.tags,
        status: overrides.status ?? "ACTIVE",
        expiresAt: overrides.expiresAt ?? null,
        createdByUserId: fixture.userId,
        approvedByUserId: fixture.userId,
        approvedAt: new Date(),
      },
    });
  }

  it("returns nothing when no item's tags/title overlap the query", async () => {
    await createItem({ title: "Compatibilidad Ranger", content: "Encaja en Ranger 2019-2023.", category: "COMPATIBILITY", tags: ["ranger"] });

    const results = await source.search("hola quiero un kit para mi corolla", fixture.businessId);
    expect(results).toEqual([]);
  });

  it("returns a matching item, correctly mapped to kind + content", async () => {
    const item = await createItem({
      title: "Compatibilidad kit TRAVO Hilux",
      content: "El kit TRAVO es compatible con Toyota Hilux 2016-2023.",
      category: "COMPATIBILITY",
      tags: ["hilux", "travo"],
    });

    const results = await source.search("tienen kit travo para mi hilux 2020?", fixture.businessId);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(item.id);
    expect(results[0].kind).toBe("compatibility");
    expect(results[0].content).toBe(`${item.title}\n${item.content}`);
  });

  it("excludes SUPERSEDED and ARCHIVED items even when tags match", async () => {
    await createItem({ title: "Viejo precio kit", content: "Precio antiguo.", category: "PRICING", tags: ["kit"], status: "SUPERSEDED" });
    await createItem({ title: "Archivado kit", content: "Ya no aplica.", category: "PRICING", tags: ["kit"], status: "ARCHIVED" });

    const results = await source.search("cuanto cuesta el kit", fixture.businessId);
    expect(results).toEqual([]);
  });

  it("excludes an item whose expiresAt is in the past, but includes one expiring in the future", async () => {
    await createItem({
      title: "Promo vencida kit",
      content: "20% de descuento en kit.",
      category: "PROMOTION",
      tags: ["kit", "promo"],
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const stillValid = await createItem({
      title: "Promo vigente kit",
      content: "15% de descuento en kit.",
      category: "PROMOTION",
      tags: ["kit", "promo"],
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
    });

    const results = await source.search("hay alguna promo de kit", fixture.businessId);
    expect(results.map((r) => r.id)).toEqual([stillValid.id]);
  });

  it("never returns another business's item, even with an identical tag match", async () => {
    const otherFixture = await createTestFixture(db, "knowledge-source-other");
    try {
      await createItem({
        title: "Compatibilidad Ranger (otro negocio)",
        content: "Datos de otro negocio.",
        category: "COMPATIBILITY",
        tags: ["ranger"],
        businessId: otherFixture.businessId,
      });

      const results = await source.search("tienen para mi ranger", fixture.businessId);
      expect(results).toEqual([]);
    } finally {
      await db.knowledgeItem.deleteMany({ where: { businessId: otherFixture.businessId } });
      await cleanupTestFixture(db, otherFixture);
    }
  });

  it("an explicit kinds filter only returns items from the mapped categories", async () => {
    await createItem({ title: "Compatibilidad Ranger", content: "Encaja en Ranger.", category: "COMPATIBILITY", tags: ["ranger"] });
    const logistics = await createItem({ title: "Envios Ranger", content: "Hacemos envios nacionales.", category: "LOGISTICS", tags: ["ranger", "envios"] });

    const results = await source.search("envios para mi ranger", fixture.businessId, ["shipping"]);
    expect(results.map((r) => r.id)).toEqual([logistics.id]);
  });

  it("a kinds filter that maps to zero categories (customer_history) returns nothing, never falls back to searching everything", async () => {
    await createItem({ title: "Compatibilidad Ranger", content: "Encaja en Ranger.", category: "COMPATIBILITY", tags: ["ranger"] });

    const results = await source.search("tienen para mi ranger", fixture.businessId, ["customer_history"]);
    expect(results).toEqual([]);
  });

  it("caps results at 5, preferring the highest-scoring/most-recent matches", async () => {
    for (let i = 0; i < 7; i++) {
      await createItem({
        title: `Kit TRAVO variante ${i}`,
        content: `Detalle de la variante ${i}.`,
        category: "PRODUCT",
        tags: ["kit", "travo"],
      });
    }

    const results = await source.search("tienen kit travo?", fixture.businessId);
    expect(results.length).toBe(5);
  });
});
