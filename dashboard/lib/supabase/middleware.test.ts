import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser },
  })),
}));

import { updateSession } from "@/lib/supabase/middleware";

describe("updateSession", () => {
  beforeEach(() => {
    getUser.mockReset();
  });

  it("redirects unauthenticated users away from app routes", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost:3000/settings");
    const response = await updateSession(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(response.headers.get("location")).toContain("/login");
  });

  it("allows unauthenticated access to login", async () => {
    getUser.mockResolvedValue({ data: { user: null } });

    const request = new NextRequest("http://localhost:3000/login");
    const response = await updateSession(request);

    expect(response.status).toBe(200);
  });

  it("redirects signed-in users away from login", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "a@example.com" } },
    });

    const request = new NextRequest("http://localhost:3000/login");
    const response = await updateSession(request);

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.headers.get("location")).toMatch(/\/$/);
  });
});
