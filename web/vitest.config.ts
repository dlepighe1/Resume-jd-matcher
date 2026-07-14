import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
    // Every provider reaches the network through fetch or the Anthropic SDK, and both are
    // stubbed in the tests — nothing here makes a real API call or spends a token. These
    // are placeholder values so the env getters resolve.
    env: {
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_MODEL: "test/free-model",
      SCORING_SERVICE_URL: "http://scoring.test",
      ANTHROPIC_API_KEY: "test-key",
    },
  },
});
