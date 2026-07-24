import type { ObservationTimelineEntryDTO } from "@/server/observer-console/types";
import { DetectorInfoPanel } from "./DetectorInfoPanel";

/**
 * A native <details> element — no client-side JS needed for expand/collapse
 * (Server Components by default; client components only for real
 * interactivity, per ARCHITECTURE.md §3's general rule).
 */
export function ObservationBadge({ observation }: { observation: ObservationTimelineEntryDTO }) {
  return (
    <details className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 text-xs" data-testid="observation-badge">
      <summary className="cursor-pointer font-medium text-neutral-700">{observation.type}</summary>
      <p className="mt-1 text-neutral-600">{observation.summary}</p>
      <DetectorInfoPanel observation={observation} />
    </details>
  );
}
