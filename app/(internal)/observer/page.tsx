import { verifySession } from "@/lib/auth/dal";
import { ConversationPicker } from "@/components/observer-console/ConversationPicker";
import { getObserverConsoleReadDependencies } from "@/server/application/composition-root";
import { searchConversations } from "@/server/observer-console/conversation-search";

export default async function ObserverIndexPage() {
  const user = await verifySession();
  const initialResults = await searchConversations(user.businessId, {}, getObserverConsoleReadDependencies());

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold text-neutral-900">Conversaciones</h1>
      <ConversationPicker initialResults={initialResults} />
    </div>
  );
}
