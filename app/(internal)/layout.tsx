import { notFound } from "next/navigation";
import { verifySession } from "@/lib/auth/dal";

/**
 * Observer Console v1 (ARCHITECTURE.md §20) — an internal/operator tool,
 * deliberately outside the (app) route group's mobile PWA shell (no bottom
 * nav, desktop-oriented). notFound() rather than a redirect for a
 * non-OWNER: this tool shouldn't be discoverable to a SALESPERSON at all
 * (see server/application/access-control.ts's assertObserverConsoleAccess
 * doc comment) — the same reasoning this app already applies to
 * cross-tenant ids (NOT_FOUND, never FORBIDDEN) extended to role gating at
 * the route level.
 */
export default async function InternalLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (user.role !== "OWNER") {
    notFound();
  }

  return (
    <div className="min-h-dvh bg-neutral-50">
      <header className="border-b border-neutral-200 bg-white px-6 py-3">
        <p className="text-sm font-medium text-neutral-500">Observer Console — internal, read-only</p>
      </header>
      <main className="mx-auto w-full max-w-5xl px-6 py-6">{children}</main>
    </div>
  );
}
