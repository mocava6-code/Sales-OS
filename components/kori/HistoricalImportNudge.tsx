import Link from "next/link";

// Finding 06 of the "Unwired Kori" product audit: the historical-import
// tool was built, shipped, and — per its own tracking (importedConversation
// count) — never actually run by any business. It used to live as the last
// card inside "Aprendizajes de Kori," several scrolls below the fold. This
// renders it as the first thing under the greeting instead, for as long as
// showHistoricalImportNudge is true — self-resolving the moment a business
// imports even one conversation.
export function HistoricalImportNudge({ show }: { show: boolean }) {
  if (!show) return null;

  return (
    <Link href="/settings/whatsapp/import" className="block">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 p-4 shadow-sm">
        <p className="text-sm leading-snug text-indigo-900">
          <span className="font-semibold">📥 Dale a Kori tu historial de WhatsApp.</span> Hoy solo ve conversaciones nuevas — importa las anteriores
          para que conozca a tus clientes desde el primer mensaje.
        </p>
        <span className="shrink-0 text-sm font-medium text-indigo-700">Importar →</span>
      </div>
    </Link>
  );
}
