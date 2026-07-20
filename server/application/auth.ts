import "server-only";

import { getCurrentUser } from "@/lib/auth/dal";
import type { User } from "@/server/db/generated/client";
import { UnauthenticatedError } from "./errors";

/**
 * Two roles exist in this app (see server/db/schema.prisma UserRole):
 * SALESPERSON is Kori's "advisor," OWNER is Kori's "admin." Nothing in this
 * layer invents a third role — authorization rules map onto these two.
 */
export type AuthenticatedUser = Pick<User, "id" | "businessId" | "role">;

/**
 * The auth boundary every application handler depends on, instead of
 * calling lib/auth/dal directly. getCurrentUser() (unlike verifySession())
 * never redirects — exactly the non-throwing primitive a safe
 * ApplicationResult needs. An explicit interface (rather than importing
 * lib/auth/dal inline everywhere) exists so tests can inject a fake
 * identity — see server/application/testing/fake-auth.ts — instead of
 * hardcoding one or mocking Next.js's cookies()/Supabase client.
 */
export interface AuthContextResolver {
  getCurrentUser(): Promise<AuthenticatedUser | null>;
}

export const defaultAuthContextResolver: AuthContextResolver = {
  getCurrentUser,
};

export async function requireAuthenticatedUser(
  resolver: AuthContextResolver = defaultAuthContextResolver,
): Promise<AuthenticatedUser> {
  const user = await resolver.getCurrentUser();
  if (!user) {
    throw new UnauthenticatedError();
  }
  return user;
}
