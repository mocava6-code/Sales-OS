"use client";

import { useState, useTransition } from "react";
import { searchConversationsAction } from "@/server/actions/observer-console";
import type { ConversationListItemDTO } from "@/server/observer-console/types";
import { ConversationListItem } from "./ConversationListItem";

const OBSERVATION_STATE_OPTIONS = [
  { value: "ANY", label: "Any" },
  { value: "HAS_ANY", label: "Has observations" },
  { value: "HAS_NONE", label: "No observations" },
] as const;

type ObservationStateOption = (typeof OBSERVATION_STATE_OPTIONS)[number]["value"];

/**
 * The one Observer Console page with real interactivity — search-as-you-go
 * over server/actions/observer-console.ts's searchConversationsAction. No
 * TanStack Query: it isn't installed in this project (checked before
 * reaching for it), and useTransition + a server action is sufficient for
 * this single read-only search box — reaching for a new dependency here
 * would be more than this milestone needs.
 */
export function ConversationPicker({ initialResults }: { initialResults: ConversationListItemDTO[] }) {
  const [searchText, setSearchText] = useState("");
  const [observationState, setObservationState] = useState<ObservationStateOption>("ANY");
  const [results, setResults] = useState(initialResults);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runSearch() {
    startTransition(async () => {
      const result = await searchConversationsAction({
        searchText: searchText.trim() || undefined,
        observationState,
      });
      if (result.ok) {
        setResults(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          runSearch();
        }}
      >
        <input
          type="search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder="Search by lead name or phone"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none"
        />
        <select
          value={observationState}
          onChange={(event) => setObservationState(event.target.value as ObservationStateOption)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          {OBSERVATION_STATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:bg-neutral-300"
        >
          {isPending ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-2">
        {results.length === 0 ? (
          <p className="text-sm text-neutral-500">No conversations match.</p>
        ) : (
          results.map((conversation) => <ConversationListItem key={conversation.id} conversation={conversation} />)
        )}
      </div>
    </div>
  );
}
