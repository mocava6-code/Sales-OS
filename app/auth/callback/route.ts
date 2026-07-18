import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { prisma } from "@/server/db/client";
import { normalizeEmail } from "@/lib/utils/email";
import { sanitizeRedirect } from "@/lib/utils/redirect";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = sanitizeRedirect(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user?.email) {
    return NextResponse.redirect(`${origin}/login?error=auth_failed`);
  }

  const email = normalizeEmail(data.user.email);
  const existingUser = await prisma.user.findUnique({ where: { email } });

  // No seeded User for this email: reject. We never auto-create a
  // Business/User here — access is provisioned out-of-band by seeding.
  if (!existingUser) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/login?error=not_authorized`);
  }

  // authUserId already set to a *different* Supabase user: an identity
  // anomaly (e.g. a reused/stale seed row). Reject rather than overwrite.
  if (existingUser.authUserId && existingUser.authUserId !== data.user.id) {
    await supabase.auth.signOut();
    console.error(
      `[auth/callback] authUserId mismatch for ${email}: seeded=${existingUser.authUserId} authenticated=${data.user.id}`,
    );
    return NextResponse.redirect(`${origin}/login?error=not_authorized`);
  }

  // First successful login for this seeded user: reconcile once. This is
  // the only write this route ever performs on User, and it never touches
  // the primary key.
  if (!existingUser.authUserId) {
    await prisma.user.update({
      where: { id: existingUser.id },
      data: { authUserId: data.user.id },
    });
  }

  return NextResponse.redirect(`${origin}${next}`);
}
