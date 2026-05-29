// Vitest config for the integration harness (#283). Separate from the
// default `vitest.config.ts` because:
//   - We boot a real Supabase stack in globalSetup (node env, longer
//     timeouts).
//   - We want `test:integration` opt-in, not coupled to `npm test`'s
//     fast mocked suite.
//
// The default suite remains the source of truth for fast feedback;
// this config exists so the integration runs only when explicitly
// invoked via `npm run test:integration`.

import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.test.ts"],
    // `*.pg.test.ts` files run against embedded-postgres (no Docker) via
    // vitest.pg.config.ts / `npm run test:pg`; keep them out of this Dockerized
    // Supabase suite so they aren't double-run against a stack they don't use.
    exclude: ["node_modules", ".next", "out", "ios", "tests/integration/**/*.pg.test.ts"],
    globalSetup: ["tests/integration/global-setup.ts"],
    // Booting supabase + applying schema + seeding fixture can run long
    // on a cold Docker boot; give the suite room without holding the
    // unit tests hostage.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
