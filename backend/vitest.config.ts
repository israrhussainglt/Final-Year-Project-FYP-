import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The RAG suite's beforeAll imports lib/rag (the whole LangChain stack) —
    // cold-starts well past the 10 s default under coverage instrumentation.
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Route tests import server.ts for its exported app; the guard on
    // app.listen() keys off NODE_ENV so the suite never binds port 4000.
    env: { NODE_ENV: "test" },
    coverage: {
      // Only measure shipped source. scripts/ is e2e/seed tooling exercised
      // by its own HTTP suites; types.ts is type-only and executes nothing.
      include: ["src/**"],
      exclude: ["src/test/**", "src/lib/types.ts"],
    },
  },
});

