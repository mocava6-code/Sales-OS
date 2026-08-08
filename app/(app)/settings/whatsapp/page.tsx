import Link from "next/link";
import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { WhatsAppPhoneNumberPanel } from "@/components/settings/WhatsAppPhoneNumberPanel";
import { toWhatsAppPhoneNumberDTO } from "@/server/application/dto";
import { listWhatsAppPhoneNumbers } from "@/server/whatsapp/phone-numbers";

export default async function WhatsAppSettingsPage() {
  const user = await verifySession();

  if (user.role !== "OWNER") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-neutral-900">WhatsApp numbers</h1>
        <Card className="text-sm text-neutral-500">Only the business owner can manage WhatsApp numbers.</Card>
      </div>
    );
  }

  const numbers = (await listWhatsAppPhoneNumbers(user.businessId)).map(toWhatsAppPhoneNumberDTO);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">WhatsApp numbers</h1>
      <p className="text-sm text-neutral-500">
        Inbound WhatsApp messages only create a Lead and Conversation for numbers registered here — this maps Meta&apos;s
        phone_number_id to this business.
      </p>

      <WhatsAppPhoneNumberPanel />

      <Link href="/settings/whatsapp/import" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Import chat history</p>
            <p className="text-sm text-neutral-500">Backfill Leads and Conversations from an exported WhatsApp chat</p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <div className="space-y-2">
        {numbers.length === 0 && <Card className="text-sm text-neutral-500">No WhatsApp numbers registered yet.</Card>}
        {numbers.map((number) => (
          <Card key={number.id}>
            <p className="font-medium text-neutral-900">{number.displayPhoneNumber}</p>
            <p className="text-sm text-neutral-500">
              phone_number_id {number.phoneNumberId} · waba {number.wabaId}
              {number.label ? ` · ${number.label}` : ""}
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
