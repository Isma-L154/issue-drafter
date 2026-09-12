import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd. `remoteBindings: false` keeps the suite offline:
// Workers AI has no local simulator and would otherwise need credentials and
// spend the daily allocation. Nothing in the suite calls the real model.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      remoteBindings: false,
      miniflare: {
        bindings: { GITHUB_TOKEN: "test-token-not-real" },
      },
    }),
  ],
});
