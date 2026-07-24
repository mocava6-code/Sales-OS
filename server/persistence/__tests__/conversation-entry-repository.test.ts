import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PrismaConversationEntryRepository } from "../prisma/prisma-conversation-entry-repository";
import { cleanupTestFixture, createTestFixture, getTestPrisma, shouldRunDbTests, type TestFixture } from "./test-db";

describe.skipIf(!shouldRunDbTests)("PrismaConversationEntryRepository (RUN_DB_TESTS=true)", () => {
  const db = shouldRunDbTests ? getTestPrisma() : undefined;
  const repo = db ? new PrismaConversationEntryRepository(db) : undefined;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await createTestFixture(db!, "conversation-entry");
  });

  afterEach(async () => {
    await cleanupTestFixture(db!, fixture);
  });

  it("lists entries chronologically and never selects rawPayload or other unlisted columns", async () => {
    await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "INBOUND",
        content: "cuánto cuesta?",
        messageType: "TEXT",
        occurredAt: new Date("2026-07-20T12:00:00.000Z"),
        externalId: "wamid.A",
        rawPayload: { secret: "never should leave this row" },
      },
    });
    await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "OUTBOUND",
        content: "el kit cuesta $1200",
        messageType: "TEXT",
        occurredAt: new Date("2026-07-20T12:05:00.000Z"),
        externalId: "wamid.B",
      },
    });

    const entries = await repo!.listForConversation(fixture.conversationId);

    expect(entries.map((e) => e.direction)).toEqual(["INBOUND", "OUTBOUND"]);
    expect(entries[0].content).toBe("cuánto cuesta?");
    expect(entries[0]).not.toHaveProperty("rawPayload");
    expect(entries[0]).not.toHaveProperty("externalId");
    expect(entries[0]).not.toHaveProperty("mediaId");
  });

  it("includes media metadata fields when present", async () => {
    await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "INBOUND",
        content: "manda foto",
        messageType: "IMAGE",
        occurredAt: new Date("2026-07-20T12:00:00.000Z"),
        externalId: "wamid.C",
        mediaId: "media-1",
        mediaMimeType: "image/jpeg",
        mediaFilename: "kit.jpg",
        mediaCaption: "aquí está",
      },
    });

    const [entry] = await repo!.listForConversation(fixture.conversationId);

    expect(entry.mediaMimeType).toBe("image/jpeg");
    expect(entry.mediaFilename).toBe("kit.jpg");
    expect(entry.mediaCaption).toBe("aquí está");
  });

  it("breaks ties on occurredAt by id asc, deterministically", async () => {
    const tiedOccurredAt = new Date("2026-07-20T12:00:00.000Z");
    const first = await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "INBOUND",
        content: "first",
        messageType: "TEXT",
        occurredAt: tiedOccurredAt,
        externalId: "wamid.TIE1",
      },
    });
    const second = await db!.conversationEntry.create({
      data: {
        conversationId: fixture.conversationId,
        direction: "INBOUND",
        content: "second",
        messageType: "TEXT",
        occurredAt: tiedOccurredAt,
        externalId: "wamid.TIE2",
      },
    });

    const entries = await repo!.listForConversation(fixture.conversationId);
    const expectedOrder = [first.id, second.id].sort();

    expect(entries.map((e) => e.id)).toEqual(expectedOrder);
  });
});
