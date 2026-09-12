import { describe, expect, it } from "vitest";
import { GitHubClient, GitHubError, type Fetch } from "../src/github.ts";

interface Recorded { url: string; method: string; headers: Headers; body: unknown }

function fakeFetch(responses: Response[]) {
  const requests: Recorded[] = [];
  const fetcher: Fetch = async (input, init) => {
    requests.push({
      url: input,
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${input}`);
    return next;
  };
  return { fetcher, requests };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const repo = (name: string, extra: Record<string, unknown> = {}) => ({
  name, private: false, archived: false, has_issues: true, owner: { login: "Isma-L154" }, ...extra,
});

describe("GitHubClient.listRepos", () => {
  it("follows pagination and keeps only open, owned repositories with issues", async () => {
    const { fetcher, requests } = fakeFetch([
      json(200, [repo("zeta"), repo("old", { archived: true })], {
        link: '<https://api.github.com/user/repos?page=2>; rel="next", <https://api.github.com/user/repos?page=2>; rel="last"',
      }),
      json(200, [repo("Alpha", { private: true }), repo("noissues", { has_issues: false }), repo("fork", { owner: { login: "someone" } })]),
    ]);
    const repos = await new GitHubClient("tok", "Isma-L154", fetcher).listRepos();

    expect(repos).toEqual([{ name: "Alpha", private: true }, { name: "zeta", private: false }]);
    expect(requests[0]?.url).toBe("https://api.github.com/user/repos?type=owner&sort=pushed&per_page=100");
    expect(requests[1]?.url).toBe("https://api.github.com/user/repos?page=2");
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer tok");
    expect(requests[0]?.headers.get("x-github-api-version")).toBe("2022-11-28");
    expect(requests[0]?.headers.get("user-agent")).toBe("issue-drafter");
  });
});

describe("GitHubClient.ensureLabel", () => {
  it("does nothing when the label exists", async () => {
    const { fetcher, requests } = fakeFetch([json(200, { name: "bug" })]);
    await new GitHubClient("tok", "Isma-L154", fetcher).ensureLabel("LoopifyBot", "bug");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.github.com/repos/Isma-L154/LoopifyBot/labels/bug");
  });

  it("creates a missing label with its color", async () => {
    const { fetcher, requests } = fakeFetch([json(404, { message: "Not Found" }), json(201, { name: "task" })]);
    await new GitHubClient("tok", "Isma-L154", fetcher).ensureLabel("LoopifyBot", "task");
    expect(requests[1]).toMatchObject({
      url: "https://api.github.com/repos/Isma-L154/LoopifyBot/labels",
      method: "POST",
      body: { name: "task", color: "c5def5" },
    });
  });

  it("treats a concurrent creation as success", async () => {
    const { fetcher } = fakeFetch([json(404, {}), json(422, { message: "Validation Failed" })]);
    await expect(new GitHubClient("tok", "Isma-L154", fetcher).ensureLabel("r", "task")).resolves.toBeUndefined();
  });
});

describe("GitHubClient.createIssue", () => {
  it("posts the rendered issue and returns its link", async () => {
    const { fetcher, requests } = fakeFetch([json(201, { number: 17, html_url: "https://github.com/Isma-L154/LoopifyBot/issues/17" })]);
    const created = await new GitHubClient("tok", "Isma-L154", fetcher).createIssue("LoopifyBot", {
      title: "Bot hangs", body: "## Summary\n\ns\n", labels: ["bug"],
    });
    expect(created).toEqual({ number: 17, url: "https://github.com/Isma-L154/LoopifyBot/issues/17" });
    expect(requests[0]).toMatchObject({
      url: "https://api.github.com/repos/Isma-L154/LoopifyBot/issues",
      method: "POST",
      body: { title: "Bot hangs", body: "## Summary\n\ns\n", labels: ["bug"] },
    });
  });

  it("throws GitHubError with GitHub's message", async () => {
    const { fetcher } = fakeFetch([json(410, { message: "Issues are disabled for this repo" })]);
    const error = await new GitHubClient("tok", "Isma-L154", fetcher)
      .createIssue("r", { title: "t", body: "b", labels: [] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect(error).toMatchObject({ status: 410, message: "Issues are disabled for this repo" });
  });

  it("encodes path segments", async () => {
    const { fetcher, requests } = fakeFetch([json(200, {})]);
    await new GitHubClient("tok", "Isma-L154", fetcher).ensureLabel("a/b", "needs info");
    expect(requests[0]?.url).toBe("https://api.github.com/repos/Isma-L154/a%2Fb/labels/needs%20info");
  });
});
