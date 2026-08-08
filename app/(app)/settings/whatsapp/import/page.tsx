import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { WhatsAppHistoryImportPanel } from "@/components/settings/WhatsAppHistoryImportPanel";
import { prisma } from "@/server/db/client";

export default async function ImportWhatsAppHistoryPage() {
  const user = await verifySession();

  if (user.role !== "OWNER") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Import chat history</h1>
        <Card className="text-sm text-neutral-500">Only the business owner can import chat history.</Card>
      </div>
    );
  }

  const business = await prisma.business.findUnique({ where: { id: user.businessId }, select: { timezone: true } });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Import chat history</h1>
      <p className="text-sm text-neutral-500">
        Backfill a Lead&apos;s Conversation from an exported WhatsApp chat (.txt or .zip). This never sends a message,
        contacts Meta, or affects live WhatsApp ingestion — it only writes past messages into the CRM.
      </p>

      <WhatsAppHistoryImportPanel defaultTimezone={business?.timezone ?? "America/Lima"} />
    </div>
  );
}
