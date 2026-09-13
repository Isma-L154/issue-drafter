import { describe, expect, it } from "vitest";
import { DraftError } from "../src/ai.ts";
import { GitHubError } from "../src/github.ts";
import { handle, type Deps } from "../src/handler.ts";
import type { DailyResult, LimitKind, MinuteKind } from "../src/limits.ts";
import type { IssueFields } from "../src/schema.ts";

const ORIGIN = "https://issues.cloudils.com";

const fields: IssueFields = {
  type: "bug", title: "Bot hangs", summary: "s", steps: [], expected: "e", actual: "a",
  impact: "", acceptance: ["c"], openQuestions: [],
};

function makeDeps(overrides: Partial<Deps> = {}) {
  const calls = { minute: [] as MinuteKind[], daily: [] as LimitKind[], drafts: 0, listings: 0, labels: [] as string[], issues: [] as unknown[] };
  const deps: Deps = {
    verify: async () => "owner@example.com",
    draft: async () => { calls.drafts++; return fields; },
    github: {
      listRepos: async () => { calls.listings++; return [{ name: "LoopifyBot", private: false }]; },
      ensureLabel: async (_repo, name) => { calls.labels.push(name); },
      createIssue: async (_repo, issue) => { calls.issues.push(issue); return { number: 7, url: "https://github.com/Isma-L154/LoopifyBot/issues/7" }; },
    },
    limits: {
      perMinute: async (kind) => { calls.minute.push(kind); return true; },
      consumeDaily: async (kind): Promise<DailyResult> => { calls.daily.push(kind); return { allowed: true, resetAt: "2026-09-13T00:00:00.000Z" }; },
    },
    now: () => new Date("2026-09-12T12:00:00Z"),
    siteOrigin: ORIGIN,
    ...overrides,
  };
  return { deps, calls };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (path: string) => new Request(`${ORIGIN}${path}`);

describe("routing and authentication", () => {
  it("serves health without authentication", async () => {
    const { deps } = makeDeps({ verify: async () => null });
    const response = await handle(get("/api/health"), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("refuses every other route without a verified identity", async () => {
    const { deps } = makeDeps({ verify: async () => null });
    for (const request of [get("/api/repos"), post("/api/draft", { note: "n", type: "auto" }), post("/api/publish", {})]) {
      const response = await handle(request, deps);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Forbidden" });
    }
  });

  it("answers 404 and 405", async () => {
    const { deps } = makeDeps();
    expect((await handle(get("/api/nope"), deps)).status).toBe(404);
    expect((await handle(get("/api/draft"), deps)).status).toBe(405);
  });

  it("sets security headers on API responses", async () => {
    const { deps } = makeDeps();
    const response = await handle(get("/api/repos"), deps);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(await response.json()).toEqual({ repos: [{ name: "LoopifyBot", private: false }] });
  });
});

describe("GET /api/repos", () => {
  it("answers 429 on the per-minute limit without calling GitHub", async () => {
    const { deps, calls } = makeDeps();
    deps.limits = { ...deps.limits, perMinute: async (kind) => { calls.minute.push(kind); return false; } };
    const response = await handle(get("/api/repos"), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(calls.minute).toEqual(["repos"]);
    expect(calls.listings).toBe(0);
  });
});

describe("CSRF", () => {
  it("refuses a foreign or missing origin and a non-JSON content type", async () => {
    const { deps, calls } = makeDeps();
    const body = { note: "n", type: "auto" };
    expect((await handle(post("/api/draft", body, { origin: "https://evil.example" }), deps)).status).toBe(403);
    expect((await handle(new Request(`${ORIGIN}/api/draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), deps)).status).toBe(403);
    expect((await handle(post("/api/draft", body, { "content-type": "text/plain" }), deps)).status).toBe(403);
    expect(calls.drafts).toBe(0);
  });
});

describe("POST /api/draft", () => {
  it("returns fields and the rendered preview", async () => {
    const { deps, calls } = makeDeps();
    const response = await handle(post("/api/draft", { note: " el bot se traba ", type: "auto" }), deps);
    expect(response.status).toBe(200);
    const json = (await response.json()) as { fields: IssueFields; preview: { title: string; labels: string[] } };
    expect(json.fields).toEqual(fields);
    expect(json.preview.title).toBe("Bot hangs");
    expect(json.preview.labels).toEqual(["bug"]);
    expect(calls.daily).toEqual(["draft"]);
  });

  it.each([
    ["invalid JSON", "{"],
    ["an empty note", { note: "   ", type: "auto" }],
    ["a note over 4000 characters", { note: "x".repeat(4001), type: "auto" }],
    ["an unknown type", { note: "n", type: "epic" }],
    ["a correction without a previous draft", { note: "n", type: "auto", correction: "c" }],
    ["an invalid previous draft", { note: "n", type: "auto", correction: "c", previous: { type: "bug" } }],
  ])("rejects %s with 400 without consuming the cap", async (_label, body) => {
    const { deps, calls } = makeDeps();
    const response = await handle(post("/api/draft", body), deps);
    expect(response.status).toBe(400);
    expect(calls.daily).toEqual([]);
  });

  it("rejects a body over 64 KB with 413", async () => {
    const { deps, calls } = makeDeps();
    expect((await handle(post("/api/draft", "x".repeat(64 * 1024 + 1)), deps)).status).toBe(413);
    expect(calls.drafts).toBe(0);
  });

  it("stops reading a streamed body without a length once it passes 64 KB", async () => {
    const { deps, calls } = makeDeps();
    const chunk = new TextEncoder().encode("x".repeat(16 * 1024));
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        if (pulled > 100) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const request = new Request(`${ORIGIN}/api/draft`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body });
    expect(request.headers.get("content-length")).toBeNull();
    expect((await handle(request, deps)).status).toBe(413);
    expect(pulled).toBeLessThan(10);
    expect(calls.drafts).toBe(0);
  });

  it("passes a correction with its previous draft to the model", async () => {
    let received: unknown;
    const { deps } = makeDeps({ draft: async (input) => { received = input; return fields; } });
    await handle(post("/api/draft", { note: "n", type: "bug", correction: " quita eso ", previous: fields }), deps);
    expect(received).toEqual({ note: "n", type: "bug", correction: "quita eso", previous: fields });
  });

  it("answers 429 with Retry-After on the per-minute limit, before the cap", async () => {
    const { deps, calls } = makeDeps();
    deps.limits = { ...deps.limits, perMinute: async () => false };
    const response = await handle(post("/api/draft", { note: "n", type: "auto" }), deps);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(calls.daily).toEqual([]);
  });

  it("answers 429 with resetAt on the daily cap", async () => {
    const { deps, calls } = makeDeps();
    deps.limits = { ...deps.limits, consumeDaily: async () => ({ allowed: false, resetAt: "2026-09-13T00:00:00.000Z" }) };
    const response = await handle(post("/api/draft", { note: "n", type: "auto" }), deps);
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ resetAt: "2026-09-13T00:00:00.000Z" });
    expect(calls.drafts).toBe(0);
  });

  it.each([
    ["invalid_output", 502],
    ["quota_exhausted", 429],
    ["unavailable", 503],
  ] as const)("maps DraftError %s to %i", async (kind, status) => {
    const { deps } = makeDeps({ draft: async () => { throw new DraftError(kind, `message for ${kind}`); } });
    const response = await handle(post("/api/draft", { note: "n", type: "auto" }), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: `message for ${kind}` });
  });
});

describe("POST /api/publish", () => {
  const valid = { repo: "LoopifyBot", type: "task", title: " Remove dead code ", body: "## Goal\n\nLess code.\n" };

  it("ensures the label from the type and creates the issue", async () => {
    const { deps, calls } = makeDeps();
    const response = await handle(post("/api/publish", { ...valid, labels: ["pwned"] }), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ number: 7, url: "https://github.com/Isma-L154/LoopifyBot/issues/7" });
    expect(calls.labels).toEqual(["task"]);
    expect(calls.issues).toEqual([{ title: "Remove dead code", body: "## Goal\n\nLess code.", labels: ["task"] }]);
    expect(calls.minute).toEqual(["publish"]);
    expect(calls.daily).toEqual(["publish"]);
  });

  it("applies the per-minute limit before listing repositories", async () => {
    const { deps, calls } = makeDeps();
    deps.limits = { ...deps.limits, perMinute: async () => false };
    const response = await handle(post("/api/publish", { ...valid, repo: "someone-elses" }), deps);
    expect(response.status).toBe(429);
    expect(calls.listings).toBe(0);
    expect(calls.daily).toEqual([]);
  });

  it.each([
    ["a repository outside the list", { ...valid, repo: "someone-elses" }],
    ["auto as type", { ...valid, type: "auto" }],
    ["an empty title", { ...valid, title: " " }],
    ["a title over 120 characters", { ...valid, title: "x".repeat(121) }],
    ["an empty body", { ...valid, body: "" }],
  ])("rejects %s with 400", async (_label, body) => {
    const { deps, calls } = makeDeps();
    expect((await handle(post("/api/publish", body), deps)).status).toBe(400);
    expect(calls.issues).toEqual([]);
    expect(calls.daily).toEqual([]);
  });

  it.each([
    [401, 502, "GitHub rejected the token or it lacks permission."],
    [403, 502, "GitHub rejected the token or it lacks permission."],
    [410, 400, "The repository is unavailable or has issues disabled."],
    [422, 400, "Validation Failed"],
    [500, 502, "GitHub failed: Validation Failed"],
  ])("maps GitHub %i to %i", async (githubStatus, status, message) => {
    const { deps } = makeDeps();
    deps.github = { ...deps.github, createIssue: async () => { throw new GitHubError(githubStatus, "Validation Failed"); } };
    const response = await handle(post("/api/publish", valid), deps);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: message });
  });

  it("hides unexpected errors", async () => {
    const { deps } = makeDeps();
    deps.github = { ...deps.github, listRepos: async () => { throw new TypeError("secret detail"); } };
    const response = await handle(post("/api/publish", valid), deps);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Unexpected error." });
  });
});
