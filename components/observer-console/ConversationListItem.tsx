import Link from "next/link";
import { Card } from "@/components/ui/Card";
import type { ConversationListItemDTO } from "@/server/observer-console/types";

export function ConversationListItem({ conversation }: { conversation: ConversationListItemDTO }) {
  return (
    <Link href={`/observer/${conversation.id}`} data-testid="conversation-list-item">
      <Card className="flex items-center justify-between transition-colors hover:border-neutral-400">
        <div>
          <p className="font-medium text-neutral-900">{conversation.leadName}</p>
          <p className="text-sm text-neutral-500">
            {conversation.leadPhone} · {conversation.status}
          </p>
        </div>
        <div className="text-right text-sm text-neutral-500">
          <p>{new Date(conversation.lastEntryAt).toLocaleDateString()}</p>
          <p>{conversation.observationCount} observation{conversation.observationCount === 1 ? "" : "s"}</p>
        </div>
      </Card>
    </Link>
  );
}
