// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConversationPicker } from "../ConversationPicker";

vi.mock("@/server/actions/observer-console", () => ({
  searchConversationsAction: vi.fn(),
}));

import { searchConversationsAction } from "@/server/actions/observer-console";

const initialResults = [
  {
    id: "conv-1",
    leadName: "Maria Gonzalez",
    leadPhone: "+525512345678",
    status: "NEEDS_REPLY",
    lastEntryAt: "2026-07-24T09:00:00.000Z",
    observationCount: 2,
  },
];

describe("ConversationPicker", () => {
  it("renders the initial results without calling the search action", () => {
    render(<ConversationPicker initialResults={initialResults} />);

    expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
    expect(searchConversationsAction).not.toHaveBeenCalled();
  });

  it("shows a placeholder when there are no results", () => {
    render(<ConversationPicker initialResults={[]} />);

    expect(screen.getByText("No conversations match.")).toBeInTheDocument();
  });

  it("calls searchConversationsAction with the entered filters and renders the new results", async () => {
    vi.mocked(searchConversationsAction).mockResolvedValue({
      ok: true,
      data: [
        {
          id: "conv-2",
          leadName: "Carlos Ruiz",
          leadPhone: "+525599999999",
          status: "WAITING_ON_CUSTOMER",
          lastEntryAt: "2026-07-23T09:00:00.000Z",
          observationCount: 0,
        },
      ],
    });

    render(<ConversationPicker initialResults={initialResults} />);

    fireEvent.change(screen.getByPlaceholderText("Search by lead name or phone"), { target: { value: "carlos" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Carlos Ruiz")).toBeInTheDocument());

    expect(searchConversationsAction).toHaveBeenCalledWith({ searchText: "carlos", observationState: "ANY" });
    expect(screen.queryByText("Maria Gonzalez")).not.toBeInTheDocument();
  });

  it("shows the error message and keeps prior results when the action fails", async () => {
    vi.mocked(searchConversationsAction).mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "You don't have permission to do that." },
    });

    render(<ConversationPicker initialResults={initialResults} />);

    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("You don't have permission to do that.")).toBeInTheDocument());
    expect(screen.getByText("Maria Gonzalez")).toBeInTheDocument();
  });
});
