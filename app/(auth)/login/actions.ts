"use server";

import { createClient } from "@/lib/supabase/server";

export type LoginState = { message: string } | undefined;

export async function requestMagicLink(
  _prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email || !email.includes("@")) {
    return { message: "Enter a valid email address." };
  }

  console.log("[login/requestMagicLink] server action invoked");

  const supabase = await createClient();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const emailRedirectTo = `${siteUrl}/auth/callback`;

  console.log(`[login/requestMagicLink] emailRedirectTo=${emailRedirectTo}`);

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo,
    },
  });

  if (error) {
    console.log(`[login/requestMagicLink] signInWithOtp error code=${error.code ?? "unknown"} message=${error.message}`);
  } else {
    console.log("[login/requestMagicLink] signInWithOtp succeeded");
  }

  // Deliberately generic: Supabase's own auth.users table doesn't know about
  // our seeded User table, so this response can't confirm or deny whether
  // the email is provisioned either way.
  return { message: "If this account is registered, check your email for a sign-in link." };
}
