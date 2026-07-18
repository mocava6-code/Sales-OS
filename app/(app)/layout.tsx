import { verifySession } from "@/lib/auth/dal";
import { BottomNav } from "@/components/shared/BottomNav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await verifySession();

  return (
    <div className="min-h-dvh bg-neutral-50 pb-20">
      <main className="mx-auto w-full max-w-lg px-4 pt-6">{children}</main>
      <BottomNav />
    </div>
  );
}
