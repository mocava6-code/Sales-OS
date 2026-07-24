// The one deterministic ordering rule used everywhere in Observer Console:
// occurredAt asc, then id asc as a tie-break. Applied both at the
// repository/query level (server/persistence/prisma/**) and again here at
// in-memory assembly time — observations attached to the same DomainEvent
// typically share the *exact* same occurredAt (recordDomainEvent stamps
// every derived Observation with the triggering event's own occurredAt),
// so the id tie-break is often the only thing making their relative order
// deterministic at all. Tests assert against this exact function rather
// than hardcoding an expected order, so the two never drift apart.

export interface OccurredAtOrdered {
  occurredAt: Date;
  id: string;
}

export function compareByOccurredAtThenId(a: OccurredAtOrdered, b: OccurredAtOrdered): number {
  const diff = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (diff !== 0) return diff;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}
