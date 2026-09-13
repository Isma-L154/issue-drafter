import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createLimits, type RateLimiter, type UsageStore } from "../src/limits.ts";

function memoryStore() {
  const data = new Map<string, string>();
  const ttls = new Map<string, number | undefined>();
  const store: UsageStore = {
    async get(key) { return data.get(key) ?? null; },
    async put(key, value, options) { data.set(key, value); ttls.set(key, options?.expirationTtl); },
  };
  return { store, data, ttls };
}

const allow: RateLimiter = { async limit() { return { success: true }; } };
const deny: RateLimiter = { async limit() { return { success: false }; } };

describe("consumeDaily", () => {
  const now = new Date("2026-09-12T23:59:30Z");

  it("counts per kind and UTC day, and reports the next midnight", async () => {
    const { store, data, ttls } = memoryStore();
    const limits = createLimits({ draftLimiter: allow, publishLimiter: allow, reposLimiter: allow, store, draftCap: 2, publishCap: 1 });

    expect(await limits.consumeDaily("draft", now)).toEqual({ allowed: true, resetAt: "2026-09-13T00:00:00.000Z" });
    expect(await limits.consumeDaily("draft", now)).toMatchObject({ allowed: true });
    expect(await limits.consumeDaily("draft", now)).toMatchObject({ allowed: false });
    expect(data.get("usage:draft:2026-09-12")).toBe("2");
    expect(ttls.get("usage:draft:2026-09-12")).toBe(172800);

    expect(await limits.consumeDaily("publish", now)).toMatchObject({ allowed: true });
    expect(await limits.consumeDaily("draft", new Date("2026-09-13T00:00:01Z"))).toMatchObject({ allowed: true });
  });

  it("fails closed on an invalid cap", async () => {
    const { store } = memoryStore();
    const limits = createLimits({ draftLimiter: allow, publishLimiter: allow, reposLimiter: allow, store, draftCap: Number(""), publishCap: Number.NaN });
    expect(await limits.consumeDaily("draft", now)).toMatchObject({ allowed: false });
    expect(await limits.consumeDaily("publish", now)).toMatchObject({ allowed: false });
  });
});

describe("perMinute", () => {
  it("uses the limiter of the matching kind, keyed by identity", async () => {
    const keys: string[] = [];
    const recording: RateLimiter = { async limit({ key }) { keys.push(key); return { success: true }; } };
    const limits = createLimits({ draftLimiter: recording, publishLimiter: deny, reposLimiter: deny, store: memoryStore().store, draftCap: 1, publishCap: 1 });
    expect(await limits.perMinute("draft", "owner@example.com")).toBe(true);
    expect(await limits.perMinute("publish", "owner@example.com")).toBe(false);
    expect(await limits.perMinute("repos", "owner@example.com")).toBe(false);
    expect(keys).toEqual(["owner@example.com"]);
  });

  // The limits match wrangler.jsonc, so a changed binding fails here.
  it.each([
    ["draft", 10],
    ["publish", 5],
    ["repos", 20],
  ] as const)("is enforced by the real %s binding after %i requests", async (kind, limit) => {
    const limits = createLimits({
      draftLimiter: env.DRAFT_LIMITER, publishLimiter: env.PUBLISH_LIMITER, reposLimiter: env.REPOS_LIMITER,
      store: env.USAGE, draftCap: 150, publishCap: 50,
    });
    const results: boolean[] = [];
    for (let i = 0; i <= limit; i++) results.push(await limits.perMinute(kind, `burst-${kind}@example.com`));
    expect(results.slice(0, limit).every(Boolean)).toBe(true);
    expect(results[limit]).toBe(false);
  });
});
