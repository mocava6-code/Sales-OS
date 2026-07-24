import { describe, expect, it, vi } from "vitest";
import type { PrismaClientOrTransaction } from "../../persistence/prisma/client";
import { closeConversation, type CloseConversationDependencies } from "../conversation-service";

function fakeRecordDomainEvent(impl?: CloseConversationDependencies["recordDomainEvent"]) {
  return vi.fn<NonNullable<CloseConversationDependencies["recordDomainEvent"]>>(
    impl ?? (async () => ({ domainEvent: {} as never, observations: [] })),
  );
}

function fakeDb(conversation: {
  id: string;
  businessId: string;
  lastEntryDirection: "INBOUND" | "OUTBOUND";
  lastEntryAt: Date;
}) {
  return {
    conversation: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...conversation, ...data })),
    },
  } as unknown as PrismaClientOrTransaction;
}

describe("closeConversation", () => {
  it("transitions the conversation's status to CLOSED and returns the updated row", async () => {
    const db = fakeDb({
      id: "conv-1",
      businessId: "biz-1",
      lastEntryDirection: "OUTBOUND",
      lastEntryAt: new Date("2026-01-01T12:00:00Z"),
    });
    const recordDomainEvent = fakeRecordDomainEvent();

    const result = await closeConversation("conv-1", db, { recordDomainEvent });

    expect(result.status).toBe("CLOSED");
    expect(db.conversation.update).toHaveBeenCalledWith({ where: { id: "conv-1" }, data: { status: "CLOSED" } });
  });

  it("records a CONVERSATION_CLOSED domain event carrying the conversation's last-entry state", async () => {
    const lastEntryAt = new Date("2026-01-01T12:00:00Z");
    const db = fakeDb({ id: "conv-1", businessId: "biz-1", lastEntryDirection: "OUTBOUND", lastEntryAt });
    const recordDomainEvent = fakeRecordDomainEvent();

    await closeConversation("conv-1", db, { recordDomainEvent });

    expect(recordDomainEvent).toHaveBeenCalledTimes(1);
    expect(recordDomainEvent.mock.calls[0][0].event).toMatchObject({
      type: "CONVERSATION_CLOSED",
      businessId: "biz-1",
      conversationId: "conv-1",
      lastEntryDirection: "OUTBOUND",
      lastEntryAt,
    });
  });

  it("swallows a domain-event recording failure — never throws, the close itself still succeeds", async () => {
    const db = fakeDb({
      id: "conv-1",
      businessId: "biz-1",
      lastEntryDirection: "INBOUND",
      lastEntryAt: new Date(),
    });
    const recordDomainEvent = fakeRecordDomainEvent(async () => {
      throw new Error("persistence unavailable");
    });

    const result = await closeConversation("conv-1", db, { recordDomainEvent });

    expect(result.status).toBe("CLOSED");
  });
});
