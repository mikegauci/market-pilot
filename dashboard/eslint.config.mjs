import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const serverOnlyImports = [
  {
    name: "@/lib/queries",
    message:
      "Use @/lib/data-client in client components. queries.ts is server-only.",
  },
  {
    name: "@/lib/supabase/server",
    message: "Use @/lib/supabase/client in client components.",
  },
  {
    name: "@/lib/resolve-current-equity",
    message: "resolve-current-equity is server-only.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["components/**/*.{ts,tsx}", "app/(auth)/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { paths: serverOnlyImports }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
