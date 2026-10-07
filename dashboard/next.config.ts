import type { NextConfig } from "next";

const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(allowedDevOrigins.length > 0 ? { allowedDevOrigins } : {}),
  serverExternalPackages: ["openai"],
  /** Client trade polls use the same IBKR pin as Server Components. */
  env: {
    DASHBOARD_IBKR_ACCOUNT_ID: process.env.DASHBOARD_IBKR_ACCOUNT_ID ?? "",
  },
};

export default nextConfig;
