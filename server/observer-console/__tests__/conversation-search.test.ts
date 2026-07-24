import { describe, expect, it, vi } from "vitest";
import { searchConversations } from "../conversation-search";
import { createFakeConversationSearchRepository } from "./fakes";

describe("searchConversations", () => {
  it("maps repository results to DTOs with ISO timestamps", async () => {
    const dependencies = {
      conversationSearch: createFakeConversationSearchRepository([
        {
          id: "conv-1",
          leadName: "Maria Gonzalez",
          leadPhone: "+525512345678",
          status: "NEEDS_REPLY",
          lastEntryAt: new Date("2026-07-24T09:00:00Z"),
          observationCount: 2,
        },
      ]),
    };

    const results = await searchConversations("biz-1", {}, dependencies);

    expect(results).toEqual([
      {
        id: "conv-1",
        leadName: "Maria Gonzalez",
        leadPhone: "+525512345678",
        status: "NEEDS_REPLY",
        lastEntryAt: "2026-07-24T09:00:00.000Z",
        observationCount: 2,
      },
    ]);
  });

  it("passes businessId, filters, and limit through to the repository unchanged", async () => {
    const search = vi.fn(async () => []);
    const dependencies = { conversationSearch: { search } };

    await searchConversations("biz-1", { searchText: "maria", observationState: "HAS_ANY" }, dependencies, 5);

    expect(search).toHaveBeenCalledWith("biz-1", { searchText: "maria", observationState: "HAS_ANY" }, 5);
  });
});
