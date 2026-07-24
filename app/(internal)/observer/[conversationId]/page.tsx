import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";
import { ConversationTimeline } from "@/components/observer-console/ConversationTimeline";
import { loadAuthorizedConversationForObserverConsole } from "@/server/application/access-control";
import { getObserverConsoleReadDependencies } from "@/server/application/composition-root";
import { toConversationTimelineDTO } from "@/server/application/dto";
import { NotFoundError } from "@/server/application/errors";
import { buildConversationTimeline } from "@/server/observer-console/build-conversation-timeline";

// Role (OWNER-only) is already enforced by app/(internal)/layout.tsx —
// this page trusts that guard the same way app/(app)/**'s pages trust
// verifySession() in app/(app)/layout.tsx, rather than re-checking role
// here and risking an uncaught throw on a redundant second check.
export default async function ObserverConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const user = await verifySession();

  const header = await loadAuthorizedConversationForObserverConsole(user, conversationId).catch((error) => {
    if (error instanceof NotFoundError) {
      notFound();
    }
    throw error;
  });

  const events = await buildConversationTimeline(conversationId, getObserverConsoleReadDependencies());
  const timeline = toConversationTimelineDTO(header, events);

  return <ConversationTimeline timeline={timeline} />;
}
