// Vitest config for the embedded-postgres integration suite (`*.pg.test.ts`).
//
// Distinct from vitest.integration.config.ts: those tests boot a Dockerized
// Supabase stack via global-setup and talk to it through PostgREST. These boot
// a throwaway embedded-postgres cluster INSIDE each test file's beforeAll and
// drive it through a raw `pg` client — so there is NO globalSetup here, and no
// Docker/virtualization requirement. Run with `npm run test:pg`.

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/integration/**/*.pg.test.ts"],
    exclude: ["node_modules", ".next", "out", "ios"],
    // initdb + cluster boot happens in beforeAll; give it room. The cluster
    // binary ships extracted with @embedded-postgres/windows-x64, so there's
    // no download — but a cold initdb on Windows can still take ~10-20s.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
