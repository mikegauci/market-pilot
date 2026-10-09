import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getClaims },
  })),
}));

import { updateSession } from "@/lib/supabase/middleware";

describe("updateSession", () => {
  beforeEach(() => {
    getClaims.mockReset();
  });

  it("redirects unauthenticated users away from app routes", async () => {
    getClaims.mockResolvedValue({ data: null });

    const request = new NextRequest("http://localhost:3000/settings");
    const response = await updateSession(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("allows unauthenticated access to login", async () => {
    getClaims.mockResolvedValue({ data: null });

    const request = new NextRequest("http://localhost:3000/login");
    const response = await updateSession(request);

    expect(response.status).toBe(200);
  });

  it("redirects signed-in users away from login", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "a@example.com" } },
    });

    const request = new NextRequest("http://localhost:3000/login");
    const response = await updateSession(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toMatch(/\/$/);
  });
});
