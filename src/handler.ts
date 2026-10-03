import { DraftError } from "./ai.ts";
import { GitHubError, type CreatedIssue, type NewIssue, type Repo } from "./github.ts";
import type { Limits, LimitKind, MinuteKind } from "./limits.ts";
import type { DraftInput } from "./prompt.ts";
import { LABELS, renderIssue } from "./render.ts";
import { MAX_TITLE, isIssueType, isRequestedType, validateFields, type IssueFields } from "./schema.ts";

export interface Deps {
  verify(request: Request): Promise<string | null>;
  draft(input: DraftInput): Promise<IssueFields>;
  github: {
    listRepos(): Promise<Repo[]>;
    ensureLabel(repo: string, name: string): Promise<void>;
    createIssue(repo: string, issue: NewIssue): Promise<CreatedIssue>;
  };
  limits: Limits;
  now(): Date;
  siteOrigin: string;
}

const MAX_BODY_BYTES = 64 * 1024;
const MAX_NOTE = 4000;
const MAX_ISSUE_BODY = 60000;
// Each repository spends up to three GitHub requests on top of the five a
// listing can take, and the Workers Free plan allows 50 per invocation.
const MAX_REPOS = 10;

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

function repoNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((name): name is string => typeof name === "string")) {
    throw badRequest("repos must be a non-empty list of repository names.");
  }
  const names = [...new Set(value)];
  if (names.length > MAX_REPOS) throw badRequest(`repos must list at most ${MAX_REPOS} repositories.`);
  return names;
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

async function consumeDaily(deps: Deps, kind: LimitKind, amount = 1): Promise<void> {
  const daily = await deps.limits.consumeDaily(kind, deps.now(), amount);
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
  if (!isIssueType(type)) throw badRequest('type must be "bug", "feature" or "task".');
  const title = boundedText(body["title"], "title", MAX_TITLE);
  const issueBody = boundedText(body["body"], "body", MAX_ISSUE_BODY);
  const repos = repoNames(body["repos"]);

  // Before the repository check, which lists repositories on GitHub. The daily
  // cap waits until the request is known to be valid.
  await checkPerMinute(deps, "publish", identity);
  const owned = new Set((await deps.github.listRepos()).map((repo) => repo.name));
  if (!repos.every((repo) => owned.has(repo))) throw badRequest("repos must all be your repositories.");

  await consumeDaily(deps, "publish", repos.length);
  const label = LABELS[type];
  const issue = { title, body: issueBody, labels: [label] };
  const created: (CreatedIssue & { repo: string })[] = [];
  const failed: { repo: string; error: unknown }[] = [];
  // One at a time: GitHub asks for content-creating requests to be serial.
  for (const repo of repos) {
    try {
      await deps.github.ensureLabel(repo, label);
      created.push({ repo, ...(await deps.github.createIssue(repo, issue)) });
    } catch (error) {
      failed.push({ repo, error });
    }
  }

  // With nothing created the request answers as a single-repository publish always has.
  if (created.length === 0) throw failed[0]?.error;
  return json(201, { created, failed: failed.map(({ repo, error }) => ({ repo, error: toHttpError(error).message })) });
}

// One mapping for every error, so a failure reported for one repository reads
// the same as an error answered for the whole request.
function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof DraftError) {
    return new HttpError({ invalid_output: 502, quota_exhausted: 429, unavailable: 503 }[error.kind], error.message);
  }
  if (error instanceof GitHubError) {
    if (error.status === 401 || error.status === 403) return new HttpError(502, "GitHub rejected the token or it lacks permission.");
    if (error.status === 404 || error.status === 410) return new HttpError(400, "The repository is unavailable or has issues disabled.");
    if (error.status === 422) return new HttpError(400, error.message);
    return new HttpError(502, `GitHub failed: ${error.message}`);
  }
  // Only the name: messages can carry request content, which is never logged.
  console.error("Unexpected error", error instanceof Error ? error.name : typeof error);
  return new HttpError(500, "Unexpected error.");
}

function errorResponse(error: unknown): Response {
  const { status, message, extra, headers } = toHttpError(error);
  return json(status, { error: message, ...extra }, headers);
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
