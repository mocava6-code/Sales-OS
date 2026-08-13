import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { ConversationListItemDTO } from "@/server/observer-console/types";
import { formatDate } from "@/lib/copy/format";
import { CONVERSATION_STATUS_LABELS } from "@/lib/copy/labels";

export function ConversationListItem({ conversation }: { conversation: ConversationListItemDTO }) {
  return (
    <Link href={`/observer/${conversation.id}`} data-testid="conversation-list-item">
      <Card className="flex items-center justify-between transition-colors hover:border-neutral-400">
        <div>
          <p className="font-medium text-neutral-900">{conversation.leadName}</p>
          <p className="text-sm text-neutral-500">
            {conversation.leadPhone} · {CONVERSATION_STATUS_LABELS[conversation.status as keyof typeof CONVERSATION_STATUS_LABELS] ?? conversation.status}
          </p>
        </div>
        <div className="text-right text-sm text-neutral-500">
          <p>{formatDate(new Date(conversation.lastEntryAt))}</p>
          <p>{conversation.observationCount} {conversation.observationCount === 1 ? "observación" : "observaciones"}</p>
        </div>
      </Card>
    </Link>
  );
}
