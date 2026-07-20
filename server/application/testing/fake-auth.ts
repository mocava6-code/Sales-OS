import type { AuthContextResolver, AuthenticatedUser } from "../auth";

export function createFakeAuthContextResolver(user: AuthenticatedUser | null): AuthContextResolver {
  return { getCurrentUser: async () => user };
}
