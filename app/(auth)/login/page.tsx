import { LoginForm } from "@/components/auth/LoginForm";

const ERROR_MESSAGES: Record<string, string> = {
  auth_failed: "That sign-in link didn't work. Request a new one below.",
  not_authorized: "This account isn't authorized for Sales OS. Contact your administrator.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-50 px-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-neutral-900">Sales OS</h1>
          <p className="mt-1 text-sm text-neutral-500">Sign in with your work email</p>
        </div>
        {errorMessage && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorMessage}</p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
