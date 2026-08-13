import type { ObservationCatalogEntryDTO } from "@/server/observer-console/types";
import { formatDateTime } from "@/lib/copy/format";

export function ObservationCatalogTable({ counts }: { counts: ObservationCatalogEntryDTO[] }) {
  if (counts.length === 0) {
    return <p className="text-sm text-neutral-500">Todavía no hay observaciones registradas.</p>;
  }

  return (
    <table className="w-full text-sm" data-testid="observation-catalog-table">
      <thead>
        <tr className="border-b border-neutral-200 text-left text-neutral-500">
          <th className="py-2 font-medium">Tipo de observación</th>
          <th className="py-2 font-medium">Cantidad</th>
          <th className="py-2 font-medium">Última vez</th>
        </tr>
      </thead>
      <tbody>
        {counts.map((row) => (
          <tr key={row.type} className="border-b border-neutral-100">
            <td className="py-2 text-neutral-800">{row.type}</td>
            <td className="py-2 text-neutral-800">{row.count}</td>
            <td className="py-2 text-neutral-500">{row.lastSeenAt ? formatDateTime(new Date(row.lastSeenAt)) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
