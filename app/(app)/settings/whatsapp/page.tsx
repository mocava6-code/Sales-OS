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
        <h1 className="text-2xl font-semibold text-neutral-900">Números de WhatsApp</h1>
        <Card className="text-sm text-neutral-500">Solo el propietario del negocio puede administrar los números de WhatsApp.</Card>
      </div>
    );
  }

  const numbers = (await listWhatsAppPhoneNumbers(user.businessId)).map(toWhatsAppPhoneNumberDTO);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Números de WhatsApp</h1>
      <p className="text-sm text-neutral-500">
        Los mensajes entrantes de WhatsApp solo crean un cliente y una conversación para los números registrados aquí — esto
        vincula el phone_number_id de Meta con este negocio.
      </p>

      <WhatsAppPhoneNumberPanel />

      <Link href="/settings/whatsapp/import" className="block">
        <Card className="flex items-center justify-between">
          <div>
            <p className="font-medium text-neutral-900">Importar historial de chat</p>
            <p className="text-sm text-neutral-500">Carga clientes y conversaciones desde un chat de WhatsApp exportado</p>
          </div>
          <span className="text-neutral-400">→</span>
        </Card>
      </Link>

      <div className="space-y-2">
        {numbers.length === 0 && <Card className="text-sm text-neutral-500">Todavía no hay números de WhatsApp registrados.</Card>}
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
