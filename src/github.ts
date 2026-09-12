import type { RenderedIssue } from "./render.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Repo {
  name: string;
  private: boolean;
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export class GitHubError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

interface RawRepo {
  name: string;
  private: boolean;
  archived: boolean;
  has_issues: boolean;
  owner: { login: string };
}

const API = "https://api.github.com";
const MAX_PAGES = 5;
const LABEL_COLORS: Record<string, string> = { bug: "d73a4a", enhancement: "a2eeef" };
const DEFAULT_LABEL_COLOR = "c5def5";

function nextLink(header: string | null): string | undefined {
  return header?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

async function errorFrom(response: Response): Promise<GitHubError> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message : `GitHub answered ${response.status}`;
  return new GitHubError(response.status, message);
}

export class GitHubClient {
  private readonly token: string;
  private readonly owner: string;
  private readonly fetcher: Fetch;

  constructor(token: string, owner: string, fetcher?: Fetch) {
    this.token = token;
    this.owner = owner;
    // Wrapped: calling a stored `fetch` as a method throws "Illegal invocation" in workerd.
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  private request(url: string, method = "GET", body?: unknown): Promise<Response> {
    const init: RequestInit = {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "issue-drafter",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    return this.fetcher(url, init);
  }

  private repoPath(repo: string): string {
    return `${API}/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(repo)}`;
  }

  async listRepos(): Promise<Repo[]> {
    const repos: Repo[] = [];
    let url: string | undefined = `${API}/user/repos?type=owner&sort=pushed&per_page=100`;
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const response = await this.request(url);
      if (!response.ok) throw await errorFrom(response);
      for (const raw of (await response.json()) as RawRepo[]) {
        if (raw.owner.login === this.owner && !raw.archived && raw.has_issues) {
          repos.push({ name: raw.name, private: raw.private });
        }
      }
      url = nextLink(response.headers.get("link"));
    }
    return repos.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }

  async ensureLabel(repo: string, name: string): Promise<void> {
    const existing = await this.request(`${this.repoPath(repo)}/labels/${encodeURIComponent(name)}`);
    if (existing.ok) return;
    if (existing.status !== 404) throw await errorFrom(existing);

    const created = await this.request(`${this.repoPath(repo)}/labels`, "POST", {
      name,
      color: LABEL_COLORS[name] ?? DEFAULT_LABEL_COLOR,
    });
    if (created.ok || created.status === 422) return;
    throw await errorFrom(created);
  }

  async createIssue(repo: string, issue: RenderedIssue): Promise<CreatedIssue> {
    const response = await this.request(`${this.repoPath(repo)}/issues`, "POST", {
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    });
    if (!response.ok) throw await errorFrom(response);
    const created = (await response.json()) as { number: number; html_url: string };
    return { number: created.number, url: created.html_url };
  }
}
