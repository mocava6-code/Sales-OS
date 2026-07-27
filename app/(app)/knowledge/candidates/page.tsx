import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { CandidateReviewActions } from "@/components/knowledge/CandidateReviewActions";
import { getKnowledgeCandidateCounts, listKnowledgeCandidates, type CandidateFilter } from "@/server/knowledge/queries";

const TABS: { value: CandidateFilter; label: string }[] = [
  { value: "NEW", label: "New" },
  { value: "CONFLICT", label: "Conflicts" },
  { value: "REPEATED", label: "Repeated" },
];

function isCandidateFilter(value: string | undefined): value is CandidateFilter {
  return value === "NEW" || value === "CONFLICT" || value === "REPEATED";
}

export default async function KnowledgeCandidatesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await verifySession();
  const resolvedSearchParams = await searchParams;
  const tab: CandidateFilter = isCandidateFilter(resolvedSearchParams.tab) ? resolvedSearchParams.tab : "NEW";

  const [candidates, counts] = await Promise.all([
    listKnowledgeCandidates(user.businessId, tab),
    getKnowledgeCandidateCounts(user.businessId),
  ]);

  const tabCounts: Record<CandidateFilter, number> = { NEW: counts.newCount, CONFLICT: counts.conflictCount, REPEATED: counts.repeatedCount };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Candidates</h1>

      <div className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.value}
            href={`/knowledge/candidates?tab=${t.value}`}
            className={`rounded-full px-3 py-1.5 text-sm font-medium ${
              tab === t.value ? "bg-neutral-900 text-white" : "bg-white text-neutral-700 border border-neutral-300"
            }`}
          >
            {t.label} ({tabCounts[t.value]})
          </Link>
        ))}
      </div>

      <div className="space-y-3">
        {candidates.length === 0 && <p className="text-sm text-neutral-500">Nothing here.</p>}
        {candidates.map((candidate) => (
          <Card key={candidate.id} className="space-y-2">
            <div>
              <p className="font-medium text-neutral-900">{candidate.subject}</p>
              <p className="text-sm text-neutral-700">{candidate.statement}</p>
            </div>
            <p className="text-xs text-neutral-400">
              {candidate.class === "FACTUAL" ? candidate.proposedFactualCategory : candidate.proposedBehaviorCategory} · confidence{" "}
              {Math.round(candidate.confidence * 100)}% · seen {candidate.occurrenceCount}×
            </p>
            {candidate.evidence[0] && <p className="rounded-lg bg-neutral-50 p-2 text-xs italic text-neutral-500">&ldquo;{candidate.evidence[0].evidenceText}&rdquo;</p>}
            {tab === "CONFLICT" && candidate.relationships.length > 0 && (
              <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">
                Conflicts with:{" "}
                {candidate.relationships
                  .filter((r) => r.classification === "CONTRADICTORY")
                  .map((r) => r.targetCandidate?.statement ?? r.targetKnowledgeItem?.content ?? r.targetOperationalInsight?.statement)
                  .filter(Boolean)
                  .join("; ")}
              </div>
            )}
            {user.role === "OWNER" && <CandidateReviewActions candidateId={candidate.id} />}
          </Card>
        ))}
      </div>
    </div>
  );
}
