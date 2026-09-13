import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../src/index.ts";

describe("the page", () => {
  it("is served from assets with every control the script expects", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://issues.cloudils.com/"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("content-security-policy")).toContain("object-src 'none'; base-uri 'none'");
    const html = await response.text();
    for (const id of ["repo", "type", "note", "generate", "preview", "detected-type", "title", "body", "correction", "correct", "publish", "status", "result"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('<script src="/app.js" defer></script>');
    expect(html).toContain('<link rel="icon" href="/logo.svg" type="image/svg+xml">');
    expect(html).not.toMatch(/<script>(?!<\/script>)|style="/);
  });

  it("serves the logo as SVG", async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request("https://issues.cloudils.com/logo.svg"), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/svg+xml");
  });
});
