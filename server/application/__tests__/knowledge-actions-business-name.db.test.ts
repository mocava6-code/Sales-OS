// Regression coverage for the Knowledge Ingestion conversation importer
// (analyzeConversationImportHandler, behind the "Pegar conversación" /
// "Subir exportación de WhatsApp" panel at /knowledge/sources/import) hitting
// the exact same bug already fixed on the CRM historical importer
// (server/application/whatsapp-actions.ts): participant matching only
// checked User.name, never Business.name, so a real WhatsApp Business
// export — always labeled with the account's own display name, never an
// individual advisor's — could never resolve deterministically. Kept in its
// own file (not knowledge-actions.db.test.ts) so it stays independently
// committable regardless of unrelated in-progress work in that file.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupKnowledgeTestFixture,
  createKnowledgeTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type KnowledgeTestFixture,
} from "@/server/knowledge/__tests__/test-db";
import { analyzeConversationImportHandler } from "../knowledge-actions";
import { createFakeAuthContextResolver } from "../testing/fake-auth";

describe.skipIf(!shouldRunDbTests)("analyzeConversationImportHandler — business-name participant resolution (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "knowledge-actions-biz-name");
    // The fixture's default user is "Test Owner" and its default business
    // name is "test-business-<suffix>" — deliberately renamed here to
    // "Koriaki Import" so neither string shares a whole word with "Test
    // Owner", isolating the assertion to the Business.name identifier path.
    await db!.business.update({ where: { id: fixture.businessId }, data: { name: "Koriaki Import" } });
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("resolves a WhatsApp Business export labeled with the account's own name, not an individual advisor's", async () => {
    const resolver = createFakeAuthContextResolver({ id: fixture.ownerUserId, businessId: fixture.businessId, role: "OWNER" });
    const rawText = [
      "11/8/2026, 6:11 p. m. - +51 933 888 197: Hola",
      "11/8/2026, 6:12 p. m. - Koriaki Import: ¡Hola! ¿Que tal?",
    ].join("\n");

    const result = await analyzeConversationImportHandler(
      { rawText, externalSource: "PASTED_TEXT", sourceConversationId: "test-business-name-regression" },
      { resolver, aiProvider: undefined, db: db! },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // NEEDS_PARTICIPANT_RESOLUTION would mean the old bug is back — matching
    // fell through to the User.name-only pool instead of also checking
    // Business.name.
    expect(result.data.status).toBe("COMPLETED");
  });
});
