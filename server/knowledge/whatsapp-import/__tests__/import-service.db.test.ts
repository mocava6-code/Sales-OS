// Gated: proves import-service.ts against a real sales_os_test instance —
// same RUN_DB_TESTS convention as server/whatsapp/__tests__/gateway.db.test.ts.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseWhatsAppExport } from "../parser";
import {
  createImportSource,
  findImportedConversationByFileHash,
  getImportedConversationWithMessages,
  persistParsedConversation,
} from "../import-service";
import {
  cleanupKnowledgeTestFixture,
  createKnowledgeTestFixture,
  getTestPrisma,
  shouldRunDbTests,
  type KnowledgeTestFixture,
} from "../../__tests__/test-db";

const SAMPLE_EXPORT = [
  "27/07/26, 14:00 - Los mensajes y las llamadas están cifrados de extremo a extremo.",
  "27/07/26, 14:05 - Juan Pérez: Hola, quiero saber si el TRAVO sirve para mi Hilux 2018",
  "27/07/26, 14:06 - Test Owner: Sí, el TRAVO sirve para Hilux Revo desde 2016.",
].join("\n");

describe.skipIf(!shouldRunDbTests)("import-service — real pipeline against sales_os_test (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  let fixture: KnowledgeTestFixture;

  beforeEach(async () => {
    fixture = await createKnowledgeTestFixture(db!, "import-service-db");
  });

  afterEach(async () => {
    await cleanupKnowledgeTestFixture(db!, fixture);
  });

  it("persists a parsed conversation and its messages, and flips the source to PROCESSING", async () => {
    const source = await createImportSource(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, label: "test-export.txt" },
      db!,
    );
    expect(source.status).toBe("PENDING");

    const parsed = parseWhatsAppExport({
      rawText: SAMPLE_EXPORT,
      dateOrder: "DMY",
      timezone: "America/Lima",
      knownBusinessNames: ["Test Owner"],
    });
    if (parsed.needsParticipantResolution) throw new Error("unreachable — deterministic match expected");

    const conversation = await persistParsedConversation(
      {
        businessId: fixture.businessId,
        sourceId: source.id,
        externalSource: "PASTED_TEXT",
        sourceConversationId: "test-export.txt",
        dateOrder: "DMY",
        timezone: "America/Lima",
        parsed,
      },
      db!,
    );

    expect(conversation.messages).toHaveLength(2);
    expect(conversation.resolvedBusinessSenderLabel).toBe("Test Owner");
    expect(conversation.resolutionMethod).toBe("DETERMINISTIC_USER_MATCH");

    const updatedSource = await db!.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } });
    expect(updatedSource.status).toBe("PROCESSING");

    const reloaded = await getImportedConversationWithMessages(fixture.businessId, conversation.id, db!);
    expect(reloaded?.messages.map((m) => m.resolvedRole)).toEqual(["CUSTOMER", "BUSINESS"]);
  });

  it("dedupes a re-upload of the same file via rawFileHash", async () => {
    const source = await createImportSource(
      { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, label: "test-export.txt" },
      db!,
    );
    const parsed = parseWhatsAppExport({
      rawText: SAMPLE_EXPORT,
      dateOrder: "DMY",
      timezone: "America/Lima",
      knownBusinessNames: ["Test Owner"],
    });
    if (parsed.needsParticipantResolution) throw new Error("unreachable");

    await persistParsedConversation(
      {
        businessId: fixture.businessId,
        sourceId: source.id,
        externalSource: "WHATSAPP_TXT_EXPORT",
        sourceConversationId: "test-export.txt",
        dateOrder: "DMY",
        timezone: "America/Lima",
        rawFileHash: "hash-abc123",
        parsed,
      },
      db!,
    );

    const existing = await findImportedConversationByFileHash(fixture.businessId, "hash-abc123", db!);
    expect(existing).not.toBeNull();
    expect(existing?.source.id).toBe(source.id);
  });

  it("tenant-scopes lookups — a conversation from another business is never returned", async () => {
    const otherFixture = await createKnowledgeTestFixture(db!, "import-service-db-other");
    try {
      const source = await createImportSource(
        { businessId: fixture.businessId, createdByUserId: fixture.ownerUserId, label: "test-export.txt" },
        db!,
      );
      const parsed = parseWhatsAppExport({
        rawText: SAMPLE_EXPORT,
        dateOrder: "DMY",
        timezone: "America/Lima",
        knownBusinessNames: ["Test Owner"],
      });
      if (parsed.needsParticipantResolution) throw new Error("unreachable");

      const conversation = await persistParsedConversation(
        {
          businessId: fixture.businessId,
          sourceId: source.id,
          externalSource: "PASTED_TEXT",
          sourceConversationId: "test-export.txt",
          dateOrder: "DMY",
          timezone: "America/Lima",
          parsed,
        },
        db!,
      );

      const crossTenantRead = await getImportedConversationWithMessages(otherFixture.businessId, conversation.id, db!);
      expect(crossTenantRead).toBeNull();
    } finally {
      await cleanupKnowledgeTestFixture(db!, otherFixture);
    }
  });
});
