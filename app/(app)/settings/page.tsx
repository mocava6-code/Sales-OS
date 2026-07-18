import { verifySession } from "@/lib/auth/dal";
import { signOutAction } from "@/lib/auth/actions";
import { Card } from "@/components/ui/Card";

export default async function SettingsPage() {
  const user = await verifySession();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-neutral-900">Settings</h1>

      <Card>
        <p className="font-medium text-neutral-900">{user.name}</p>
        <p className="text-sm text-neutral-500">{user.email}</p>
        <p className="mt-1 text-xs uppercase tracking-wide text-neutral-400">{user.role}</p>
      </Card>

      <form action={signOutAction}>
        <button
          type="submit"
          className="w-full rounded-xl border border-neutral-300 px-4 py-3 text-base font-medium text-neutral-700 active:bg-neutral-100"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
