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
});
