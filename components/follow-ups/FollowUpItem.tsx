import { completeFollowUpAction } from "@/server/actions/follow-ups";
import { formatDate } from "@/lib/copy/format";

export function FollowUpItem({
  id,
  leadId,
  leadName,
  dueAt,
  note,
}: {
  id: string;
  leadId: string;
  leadName: string;
  dueAt: Date;
  note: string | null;
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium text-neutral-900">{leadName}</p>
        <p className="truncate text-sm text-neutral-500">
          Vence {formatDate(dueAt)}
          {note ? ` — ${note}` : ""}
        </p>
      </div>
      <form action={completeFollowUpAction}>
        <input type="hidden" name="followUpId" value={id} />
        <input type="hidden" name="leadId" value={leadId} />
        <button
          type="submit"
          className="shrink-0 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-700 active:bg-neutral-100"
        >
          Listo
        </button>
      </form>
    </li>
  );
}
