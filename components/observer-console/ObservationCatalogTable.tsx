import type { ObservationCatalogEntryDTO } from "@/server/observer-console/types";

export function ObservationCatalogTable({ counts }: { counts: ObservationCatalogEntryDTO[] }) {
  if (counts.length === 0) {
    return <p className="text-sm text-neutral-500">No observations recorded yet.</p>;
  }

  return (
    <table className="w-full text-sm" data-testid="observation-catalog-table">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-2 font-medium">Observation type</th>
          <th className="py-2 font-medium">Count</th>
          <th className="py-2 font-medium">Last seen</th>
        </tr>
      </thead>
      <tbody>
        {counts.map((row) => (
          <tr key={row.type} className="border-b border-neutral-100">
            <td className="py-2 text-neutral-800">{row.type}</td>
            <td className="py-2 text-neutral-800">{row.count}</td>
            <td className="py-2 text-neutral-500">{row.lastSeenAt ? new Date(row.lastSeenAt).toLocaleString() : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
