import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { exchangeCodeForSession, signOut, findUnique, update } = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { exchangeCodeForSession, signOut } }),
}));

vi.mock("@/server/db/client", () => ({
  prisma: { user: { findUnique, update } },
}));

function callbackRequest(query: string) {
  return new NextRequest(`https://sales-os-wheat.vercel.app/auth/callback${query}`);
}

describe("GET /auth/callback", () => {
  beforeEach(() => {
    exchangeCodeForSession.mockReset();
    signOut.mockReset();
    findUnique.mockReset();
    update.mockReset();
  });

  it("redirects to /login?error=auth_failed when no code is present", async () => {
    const response = await GET(callbackRequest(""));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/login?error=auth_failed");
    expect(exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("redirects to /login?error=auth_failed when the code exchange fails", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error("invalid grant") });

    const response = await GET(callbackRequest("?code=abc123"));

    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/login?error=auth_failed");
  });

  it("signs out and redirects to not_authorized when no seeded User matches the authenticated email", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "auth-1", email: "new@x.com" } }, error: null });
    findUnique.mockResolvedValue(null);

    const response = await GET(callbackRequest("?code=abc123"));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/login?error=not_authorized");
    expect(update).not.toHaveBeenCalled();
  });

  it("signs out and redirects to not_authorized when the seeded authUserId belongs to a different Supabase user", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "auth-new", email: "seeded@x.com" } }, error: null });
    findUnique.mockResolvedValue({ id: "user-1", authUserId: "auth-old" });

    const response = await GET(callbackRequest("?code=abc123"));

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/login?error=not_authorized");
    expect(update).not.toHaveBeenCalled();
  });

  it("reconciles authUserId on first successful login and redirects to next", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "auth-1", email: "Seeded@X.com" } }, error: null });
    findUnique.mockResolvedValue({ id: "user-1", authUserId: null });

    const response = await GET(callbackRequest("?code=abc123&next=/leads"));

    expect(findUnique).toHaveBeenCalledWith({ where: { email: "seeded@x.com" } });
    expect(update).toHaveBeenCalledWith({ where: { id: "user-1" }, data: { authUserId: "auth-1" } });
    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/leads");
  });

  it("does not touch authUserId on a returning login where it already matches", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "auth-1", email: "seeded@x.com" } }, error: null });
    findUnique.mockResolvedValue({ id: "user-1", authUserId: "auth-1" });

    const response = await GET(callbackRequest("?code=abc123"));

    expect(update).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/");
  });

  it("regression: an open-redirect `next` value is sanitized back to the app root", async () => {
    exchangeCodeForSession.mockResolvedValue({ data: { user: { id: "auth-1", email: "seeded@x.com" } }, error: null });
    findUnique.mockResolvedValue({ id: "user-1", authUserId: "auth-1" });

    const response = await GET(callbackRequest("?code=abc123&next=https://evil.com"));

    expect(response.headers.get("location")).toBe("https://sales-os-wheat.vercel.app/");
  });
});
