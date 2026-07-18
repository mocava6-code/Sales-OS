/**
 * Only allows internal relative paths as a post-auth redirect target.
 * Blocks protocol-relative ("//evil.com"), absolute ("https://evil.com"),
 * and scheme-based ("javascript:...") values — an open-redirect guard.
 */
export function sanitizeRedirect(path: string | null | undefined): string {
  if (!path) return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//")) return "/";
  if (path.includes(":")) return "/";
  return path;
}
