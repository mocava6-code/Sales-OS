import { verifySession } from "@/lib/auth/dal";
import { Card } from "@/components/ui/Card";
import { WhatsAppHistoryImportPanel } from "@/components/settings/WhatsAppHistoryImportPanel";
import { prisma } from "@/server/db/client";

export default async function ImportWhatsAppHistoryPage() {
  const user = await verifySession();

  if (user.role !== "OWNER") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold text-neutral-900">Importar historial de chat</h1>
        <Card className="text-sm text-neutral-500">Solo el propietario del negocio puede importar historial de chat.</Card>
      </div>
    );
  }

  const business = await prisma.business.findUnique({ where: { id: user.businessId }, select: { timezone: true } });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Importar historial de chat</h1>
      <p className="text-sm text-neutral-500">
        Carga la conversación de un cliente desde un chat de WhatsApp exportado (.txt o .zip). Esto nunca envía un mensaje,
        contacta a Meta, ni afecta la recepción en vivo de WhatsApp — solo registra mensajes pasados en el CRM.
      </p>

      <WhatsAppHistoryImportPanel defaultTimezone={business?.timezone ?? "America/Lima"} />
    </div>
  );
}
