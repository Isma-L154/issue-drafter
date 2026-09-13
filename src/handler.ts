import { DraftError } from "./ai.ts";
import { GitHubError, type CreatedIssue, type Repo } from "./github.ts";
import type { Limits, LimitKind, MinuteKind } from "./limits.ts";
import type { DraftInput } from "./prompt.ts";
import { LABELS, renderIssue } from "./render.ts";
import { ISSUE_TYPES, isRequestedType, validateFields, type IssueFields, type IssueType } from "./schema.ts";

export interface Deps {
  verify(request: Request): Promise<string | null>;
  draft(input: DraftInput): Promise<IssueFields>;
  github: {
    listRepos(): Promise<Repo[]>;
    ensureLabel(repo: string, name: string): Promise<void>;
    createIssue(repo: string, issue: { title: string; body: string; labels: string[] }): Promise<CreatedIssue>;
  };
  limits: Limits;
  now(): Date;
  siteOrigin: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE = 4000;
const MAX_TITLE = 120;
const MAX_ISSUE_BODY = 60000;

const API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};

class HttpError extends Error {
  readonly status: number;
  readonly extra: Record<string, string>;
  readonly headers: Record<string, string>;

  constructor(status: number, message: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.headers = headers;
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...headers } });
}

const badRequest = (message: string) => new HttpError(400, message);
const tooLarge = () => new HttpError(413, "The request body is too large.");

function boundedText(value: unknown, name: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") throw badRequest(`${name} is required.`);
  if (text.length > max) throw badRequest(`${name} must be at most ${max} characters.`);
  return text;
}

function passesCsrf(request: Request, siteOrigin: string): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.startsWith("application/json") && request.headers.get("origin") === siteOrigin;
}

// Counted while it streams, so an oversized body is refused before it is held
// in memory, whether or not it declares a length.
async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await readBody(request);
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw badRequest("The request body must be JSON.");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("The request body must be a JSON object.");
  return value as Record<string, unknown>;
}

async function checkPerMinute(deps: Deps, kind: MinuteKind, identity: string): Promise<void> {
  if (!(await deps.limits.perMinute(kind, identity))) {
    throw new HttpError(429, "Too many requests. Wait a minute and try again.", {}, { "retry-after": "60" });
  }
}

async function consumeDaily(deps: Deps, kind: LimitKind): Promise<void> {
  const daily = await deps.limits.consumeDaily(kind, deps.now());
  if (!daily.allowed) {
    throw new HttpError(429, "The daily limit has been reached.", { resetAt: daily.resetAt });
  }
}

async function reposRoute(_request: Request, deps: Deps, identity: string): Promise<Response> {
  // Each listing is up to five GitHub requests, all spent from the token's quota.
  await checkPerMinute(deps, "repos", identity);
  return json(200, { repos: await deps.github.listRepos() });
}

async function draftRoute(request: Request, deps: Deps, identity: string): Promise<Response> {
  const body = await readJson(request);
  const note = boundedText(body["note"], "note", MAX_NOTE);
  const type = body["type"];
  if (!isRequestedType(type)) throw badRequest('type must be "auto", "bug", "feature" or "task".');

  const input: DraftInput = { note, type };
  if (body["correction"] !== undefined || body["previous"] !== undefined) {
    if (body["previous"] === undefined) throw badRequest("A correction needs the previous draft.");
    const previous = validateFields(body["previous"], "auto");
    if (!previous.ok) throw badRequest("The previous draft is not valid.");
    input.previous = previous.fields;
    input.correction = boundedText(body["correction"], "correction", MAX_NOTE);
  }

  await checkPerMinute(deps, "draft", identity);
  await consumeDaily(deps, "draft");
  const fields = await deps.draft(input);
  return json(200, { fields, preview: renderIssue(fields) });
}

async function publishRoute(request: Request, deps: Deps, identity: string): Promise<Response> {
  const body = await readJson(request);
  const type = body["type"];
  if (!(ISSUE_TYPES as readonly unknown[]).includes(type)) throw badRequest('type must be "bug", "feature" or "task".');
  const title = boundedText(body["title"], "title", MAX_TITLE);
  const issueBody = boundedText(body["body"], "body", MAX_ISSUE_BODY);

  // Before the repository check, which lists repositories on GitHub. The daily
  // cap waits until the request is known to be valid.
  await checkPerMinute(deps, "publish", identity);
  const repo = body["repo"];
  const repos = await deps.github.listRepos();
  if (typeof repo !== "string" || !repos.some((candidate) => candidate.name === repo)) {
    throw badRequest("repo must be one of your repositories.");
  }

  await consumeDaily(deps, "publish");
  const label = LABELS[type as IssueType];
  await deps.github.ensureLabel(repo, label);
  const created = await deps.github.createIssue(repo, { title, body: issueBody, labels: [label] });
  return json(201, created);
}

function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return json(error.status, { error: error.message, ...error.extra }, error.headers);
  if (error instanceof DraftError) {
    const status = { invalid_output: 502, quota_exhausted: 429, unavailable: 503 }[error.kind];
    return json(status, { error: error.message });
  }
  if (error instanceof GitHubError) {
    if (error.status === 401 || error.status === 403) return json(502, { error: "GitHub rejected the token or it lacks permission." });
    if (error.status === 404 || error.status === 410) return json(400, { error: "The repository is unavailable or has issues disabled." });
    if (error.status === 422) return json(400, { error: error.message });
    return json(502, { error: `GitHub failed: ${error.message}` });
  }
  // Only the name: messages can carry request content, which is never logged.
  console.error("Unexpected error", error instanceof Error ? error.name : typeof error);
  return json(500, { error: "Unexpected error." });
}

type Route = { method: string; csrf: boolean; run: (request: Request, deps: Deps, identity: string) => Promise<Response> };

const ROUTES: Record<string, Route> = {
  "/api/repos": { method: "GET", csrf: false, run: reposRoute },
  "/api/draft": { method: "POST", csrf: true, run: draftRoute },
  "/api/publish": { method: "POST", csrf: true, run: publishRoute },
};

export async function handle(request: Request, deps: Deps): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health") return json(200, { ok: true });

  const route = ROUTES[pathname];
  try {
    if (route?.csrf && request.method === "POST" && !passesCsrf(request, deps.siteOrigin)) {
      return json(403, { error: "Forbidden" });
    }
    // Authentication before 404, so an unauthenticated caller cannot probe which paths exist.
    const identity = await deps.verify(request);
    if (!identity) return json(403, { error: "Forbidden" });
    if (!route) return json(404, { error: "Not found." });
    if (request.method !== route.method) return json(405, { error: "Method not allowed." }, { allow: route.method });
    return await route.run(request, deps, identity);
  } catch (error) {
    return errorResponse(error);
  }
}
