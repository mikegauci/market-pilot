import { afterEach, describe, expect, it, vi } from "vitest";
import { viewerLoginConfigured } from "@/lib/viewer-login-config";

describe("viewerLoginConfigured", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is false when email or password missing", () => {
    vi.stubEnv("DASHBOARD_VIEWER_EMAIL", "");
    vi.stubEnv("DASHBOARD_VIEWER_PASSWORD", "secret");
    expect(viewerLoginConfigured()).toBe(false);

    vi.stubEnv("DASHBOARD_VIEWER_EMAIL", "viewer@test.com");
    vi.stubEnv("DASHBOARD_VIEWER_PASSWORD", "");
    expect(viewerLoginConfigured()).toBe(false);
  });

  it("is false when explicitly disabled", () => {
    vi.stubEnv("DASHBOARD_VIEWER_EMAIL", "viewer@test.com");
    vi.stubEnv("DASHBOARD_VIEWER_PASSWORD", "secret");
    vi.stubEnv("DASHBOARD_VIEWER_LOGIN_ENABLED", "false");
    expect(viewerLoginConfigured()).toBe(false);
  });

  it("is true when email and password are set", () => {
    vi.stubEnv("DASHBOARD_VIEWER_EMAIL", " viewer@test.com ");
    vi.stubEnv("DASHBOARD_VIEWER_PASSWORD", " secret ");
    expect(viewerLoginConfigured()).toBe(true);
  });
});
