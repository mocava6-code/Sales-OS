import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/server/db/client";

/**
 * Looks up the current User by authUserId — never by email. Email is only
 * ever used once, at first-login reconciliation in app/auth/callback.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();

  if (!authUser) return null;

  return prisma.user.findUnique({
    where: { authUserId: authUser.id },
  });
});

export async function verifySession() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  return user;
}
