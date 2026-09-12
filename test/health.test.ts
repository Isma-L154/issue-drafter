import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

describe("GET /api/health", () => {
  it("answers ok without authentication", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://issues.cloudils.com/api/health"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each(["GITHUB_TOKEN", "SITE_ORIGIN", "ACCESS_AUD"] as const)("answers 500 when %s is missing", async (name) => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://issues.cloudils.com/api/health"), { ...env, [name]: "" }, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "The service is not configured." });
  });
});
