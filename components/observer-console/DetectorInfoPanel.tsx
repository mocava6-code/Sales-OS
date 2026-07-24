import type { ObservationTimelineEntryDTO } from "@/server/observer-console/types";

/**
 * Documents the detector *associated with* this ObservationType — never a
 * claim about which specific rule instance fired, and never a highlighted
 * "matched" keyword or a recomputed elapsed time. See the Observer Console
 * v1.1 spec's "Rule Provenance" revision and ARCHITECTURE.md §20.
 */
export function DetectorInfoPanel({ observation }: { observation: ObservationTimelineEntryDTO }) {
  return (
    <dl className="mt-2 space-y-1 text-neutral-500" data-testid="detector-info-panel">
      <div>
        <dt className="inline font-medium text-neutral-600">Detector: </dt>
        <dd className="inline">
          {observation.detector.detectorId} ({observation.detector.kind})
        </dd>
      </div>
      <div>
        <dt className="font-medium text-neutral-600">What this means</dt>
        <dd>{observation.detector.description}</dd>
      </div>
      {observation.detector.keywordSample && (
        <div>
          <dt className="inline font-medium text-neutral-600">Sample keywords (not the exact match): </dt>
          <dd className="inline">{observation.detector.keywordSample.join(", ")}</dd>
        </div>
      )}
      {observation.evidenceExcerpt && (
        <div>
          <dt className="font-medium text-neutral-600">Message excerpt</dt>
          <dd className="italic">&ldquo;{observation.evidenceExcerpt}&rdquo;</dd>
        </div>
      )}
    </dl>
  );
}
