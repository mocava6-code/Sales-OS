// Read-model assembly service — performs one repository aggregate read
// (ObservationRepository.aggregateByType), then computes "never observed"
// as a set difference against the full ObservationType universe. Not a
// pure function: the aggregate read is real repository I/O.

import type { ObservationType } from "../intelligence/observation/types";
import { DETECTOR_REGISTRY } from "./detector-registry";
import type { ObservationCatalogDTO, ObserverConsoleReadDependencies } from "./types";

export type ListObservationCatalogDependencies = Pick<ObserverConsoleReadDependencies, "observations">;

/**
 * DETECTOR_REGISTRY's keys are the single source of truth for "every
 * ObservationType that exists" here — its own completeness test
 * (__tests__/detector-registry-completeness.test.ts) guarantees this list
 * never silently misses a type, without hand-maintaining the enum twice.
 */
const ALL_OBSERVATION_TYPES = Object.keys(DETECTOR_REGISTRY) as ObservationType[];

export async function listObservationCatalog(
  businessId: string,
  dependencies: ListObservationCatalogDependencies,
): Promise<ObservationCatalogDTO> {
  const aggregates = await dependencies.observations.aggregateByType(businessId);
  const seenTypes = new Set(aggregates.map((a) => a.type));

  const counts = aggregates
    .slice()
    .sort((a, b) => a.type.localeCompare(b.type))
    .map((a) => ({
      type: a.type,
      count: a.count,
      lastSeenAt: a.lastSeenAt ? a.lastSeenAt.toISOString() : null,
    }));

  const neverObserved = ALL_OBSERVATION_TYPES.filter((type) => !seenTypes.has(type));

  return { counts, neverObserved };
}
