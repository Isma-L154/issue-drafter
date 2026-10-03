# Publish to Several Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish one draft as an issue in up to ten selected repositories at once, keeping the single-repository flow (issue #6).

**Architecture:** `POST /api/publish` takes `repos: string[]`, validates all of them up front, spends one daily unit per repository, then creates the issues one at a time and reports `created` and `failed`. The page swaps its `<select>` for a filterable checkbox list and shows one link per created issue.

**Tech Stack:** Cloudflare Workers, TypeScript, Vitest in workerd (`@cloudflare/vitest-pool-workers`), vanilla HTML/CSS/JS.

Spec: `docs/superpowers/specs/2026-10-02-multi-repo-publish-design.md`

## Global Constraints

- Everything written to the repository is English; CI rejects Spanish accented characters outside `*.md` and `test/fixtures/`.
- At most 10 repositories per publish (Workers Free plan: 50 subrequests per invocation).
- The page has no inline scripts or `style=` attributes (CSP, checked by `test/page.test.ts`).
- Built DOM uses `textContent`, never `innerHTML`.
- Commits authored as `ismaleonsaenz@gmail.com`; no AI attribution anywhere.

Commands: `npm test`, `npx tsc --noEmit` (after `npx wrangler types`), `node --check public/app.js`.

---

### Task 1: Daily cap spends several units at once

**Files:**
- Modify: `src/limits.ts`
- Test: `test/limits.test.ts`

**Interfaces:**
- Produces: `Limits.consumeDaily(kind: LimitKind, now: Date, amount?: number): Promise<DailyResult>` — refuses when `count + amount > cap`, otherwise stores `count + amount`. `amount` defaults to 1.

- [ ] **Step 1: Write the failing test** in the `consumeDaily` describe of `test/limits.test.ts`:

```ts
  it("spends several units at once only when they all fit", async () => {
    const { store, data } = memoryStore();
    const limits = createLimits({ draftLimiter: allow, publishLimiter: allow, reposLimiter: allow, store, draftCap: 1, publishCap: 5 });

    expect(await limits.consumeDaily("publish", now, 3)).toMatchObject({ allowed: true });
    expect(await limits.consumeDaily("publish", now, 3)).toMatchObject({ allowed: false });
    expect(data.get("usage:publish:2026-09-12")).toBe("3");
    expect(await limits.consumeDaily("publish", now, 2)).toMatchObject({ allowed: true });
    expect(data.get("usage:publish:2026-09-12")).toBe("5");
  });
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- test/limits.test.ts`
Expected: FAIL, the second call is allowed (the amount is ignored).

- [ ] **Step 3: Implement** in `src/limits.ts`:

```ts
export interface Limits {
  perMinute(kind: MinuteKind, identity: string): Promise<boolean>;
  consumeDaily(kind: LimitKind, now: Date, amount?: number): Promise<DailyResult>;
}
```

```ts
    async consumeDaily(kind, now, amount = 1) {
      // ...unchanged up to the read of `count`
      if (count + amount > cap) return { allowed: false, resetAt };

      await options.store.put(key, String(count + amount), { expirationTtl: COUNTER_TTL_SECONDS });
      return { allowed: true, resetAt };
    },
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- test/limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/limits.ts test/limits.test.ts
git commit -m "Let the daily cap spend several units at once"
```

---

### Task 2: Publish route takes several repositories

**Files:**
- Modify: `src/handler.ts`
- Test: `test/handler.test.ts`

**Interfaces:**
- Consumes: `Limits.consumeDaily(kind, now, amount)` from Task 1.
- Produces: `POST /api/publish` body `{ repos: string[], type, title, body }`; `201 { created: { repo: string; number: number; url: string }[], failed: { repo: string; error: string }[] }`. With nothing created, the first failure's usual error response.

- [ ] **Step 1: Update the test helpers** in `test/handler.test.ts`. Record the amount in `makeDeps`:

```ts
  const calls = { minute: [] as MinuteKind[], daily: [] as LimitKind[], spent: [] as (number | undefined)[], drafts: 0, listings: 0, labels: [] as string[], issues: [] as unknown[] };
```

```ts
      consumeDaily: async (kind, _now, amount): Promise<DailyResult> => { calls.daily.push(kind); calls.spent.push(amount); return { allowed: true, resetAt: "2026-09-13T00:00:00.000Z" }; },
```

Then change the publish describe's `valid` and the two tests naming a foreign repository:

```ts
  const valid = { repos: ["LoopifyBot"], type: "task", title: " Remove dead code ", body: "## Goal\n\nLess code.\n" };
```

```ts
    const response = await handle(post("/api/publish", { ...valid, repos: ["someone-elses"] }), deps);
```

```ts
    ["a repository outside the list", { ...valid, repos: ["someone-elses"] }],
```

and the expected body of "ensures the label from the type and creates the issue":

```ts
    expect(await response.json()).toEqual({ created: [{ repo: "LoopifyBot", number: 7, url: "https://github.com/Isma-L154/LoopifyBot/issues/7" }], failed: [] });
```

- [ ] **Step 2: Write the failing tests** at the end of `test/handler.test.ts`:

```ts
describe("POST /api/publish to several repositories", () => {
  const REPOS = ["LoopifyBot", "issue-drafter", "dotfiles"];
  const issue = { type: "feature", title: "Add dark mode", body: "## Goal\n\nDark.\n" };

  function multiRepoDeps(failing: Record<string, Error> = {}) {
    const { deps, calls } = makeDeps();
    const order: string[] = [];
    deps.github = {
      listRepos: async () => REPOS.map((name) => ({ name, private: false })),
      ensureLabel: async (repo) => { order.push(`label ${repo}`); },
      createIssue: async (repo) => {
        order.push(`issue ${repo}`);
        const error = failing[repo];
        if (error) throw error;
        const number = REPOS.indexOf(repo) + 1;
        return { number, url: `https://github.com/Isma-L154/${repo}/issues/${number}` };
      },
    };
    return { deps, calls, order };
  }

  it("creates the issue in each repository, one after another, spending one unit each", async () => {
    const { deps, calls, order } = multiRepoDeps();
    const response = await handle(post("/api/publish", { ...issue, repos: ["issue-drafter", "LoopifyBot"] }), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      created: [
        { repo: "issue-drafter", number: 2, url: "https://github.com/Isma-L154/issue-drafter/issues/2" },
        { repo: "LoopifyBot", number: 1, url: "https://github.com/Isma-L154/LoopifyBot/issues/1" },
      ],
      failed: [],
    });
    expect(order).toEqual(["label issue-drafter", "issue issue-drafter", "label LoopifyBot", "issue LoopifyBot"]);
    expect(calls.minute).toEqual(["publish"]);
    expect(calls.spent).toEqual([2]);
  });

  it("publishes once to a repository listed twice", async () => {
    const { deps, calls, order } = multiRepoDeps();
    expect((await handle(post("/api/publish", { ...issue, repos: ["dotfiles", "dotfiles"] }), deps)).status).toBe(201);
    expect(order).toEqual(["label dotfiles", "issue dotfiles"]);
    expect(calls.spent).toEqual([1]);
  });

  it("keeps publishing after a repository fails and reports it", async () => {
    const { deps } = multiRepoDeps({ "issue-drafter": new GitHubError(410, "Gone") });
    const response = await handle(post("/api/publish", { ...issue, repos: REPOS }), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      created: [
        { repo: "LoopifyBot", number: 1, url: "https://github.com/Isma-L154/LoopifyBot/issues/1" },
        { repo: "dotfiles", number: 3, url: "https://github.com/Isma-L154/dotfiles/issues/3" },
      ],
      failed: [{ repo: "issue-drafter", error: "The repository is unavailable or has issues disabled." }],
    });
  });

  it("answers the first failure when no issue was created", async () => {
    const { deps } = multiRepoDeps({ LoopifyBot: new GitHubError(403, "Forbidden"), dotfiles: new GitHubError(410, "Gone") });
    const response = await handle(post("/api/publish", { ...issue, repos: ["LoopifyBot", "dotfiles"] }), deps);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "GitHub rejected the token or it lacks permission." });
  });

  it.each([
    ["no repos", {}],
    ["an empty list", { repos: [] }],
    ["a single name instead of a list", { repos: "LoopifyBot" }],
    ["a name that is not a string", { repos: ["LoopifyBot", 7] }],
    ["more than ten repositories", { repos: Array.from({ length: 11 }, (_, i) => `repo-${i}`) }],
    ["one repository outside the list", { repos: ["LoopifyBot", "someone-elses"] }],
  ])("rejects %s with 400 before publishing anything", async (_label, repos) => {
    const { deps, calls, order } = multiRepoDeps();
    expect((await handle(post("/api/publish", { ...issue, ...repos }), deps)).status).toBe(400);
    expect(order).toEqual([]);
    expect(calls.daily).toEqual([]);
  });

  it("publishes nothing when the daily cap cannot cover every repository", async () => {
    const { deps, order } = multiRepoDeps();
    deps.limits = { ...deps.limits, consumeDaily: async () => ({ allowed: false, resetAt: "2026-09-13T00:00:00.000Z" }) };
    expect((await handle(post("/api/publish", { ...issue, repos: REPOS }), deps)).status).toBe(429);
    expect(order).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and see them fail**

Run: `npm test -- test/handler.test.ts`
Expected: FAIL — `repos` is unknown to the route (400 "repo must be one of your repositories.").

- [ ] **Step 4: Implement** in `src/handler.ts`.

Add, next to the other constants:

```ts
// Each repository spends up to three GitHub requests on top of the five a
// listing can take, and the Workers Free plan allows 50 per invocation.
const MAX_REPOS = 10;
```

Add after `boundedText`:

```ts
function repoNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((name): name is string => typeof name === "string")) {
    throw badRequest("repos must be a non-empty list of repository names.");
  }
  const names = [...new Set(value)];
  if (names.length > MAX_REPOS) throw badRequest(`repos must list at most ${MAX_REPOS} repositories.`);
  return names;
}
```

Give `consumeDaily` an amount:

```ts
async function consumeDaily(deps: Deps, kind: LimitKind, amount = 1): Promise<void> {
  const daily = await deps.limits.consumeDaily(kind, deps.now(), amount);
```

Replace `publishRoute`:

```ts
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
```

Replace `errorResponse` with one mapping and a thin response wrapper:

```ts
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
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npm test` then `npx wrangler types && npx tsc --noEmit`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/handler.ts test/handler.test.ts
git commit -m "Publish one draft to several repositories"
```

---

### Task 3: Repository picker and result links on the page

**Files:**
- Modify: `public/index.html`, `public/app.js`, `public/styles.css`, `README.md`
- Test: `test/page.test.ts`

**Interfaces:**
- Consumes: the `POST /api/publish` contract from Task 2.
- Produces: element ids `repos`, `repo-filter`, `repo-count`, `repo-message`, `result`, `result-title`, `result-links`; `localStorage` key `repos` (string array).

- [ ] **Step 1: Write the failing test.** In `test/page.test.ts`, replace the id list:

```ts
    for (const id of ["repos", "repo-filter", "repo-count", "repo-message", "type", "note", "generate", "preview", "detected-type", "title", "body", "correction", "correct", "publish", "status", "result", "result-title", "result-links"]) {
```

- [ ] **Step 2: Run it and see it fail**

Run: `npm test -- test/page.test.ts`
Expected: FAIL on `id="repos"`.

- [ ] **Step 3: Replace the repository field** in `public/index.html` (the `<div class="field">` holding `<select id="repo">`):

```html
      <div class="field" role="group" aria-labelledby="repos-label">
        <div class="label-row">
          <span id="repos-label" class="label">Repositories</span>
          <span id="repo-count" class="counter">0 / 10 selected</span>
        </div>
        <div class="repo-picker">
          <div class="repo-filter">
            <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
            <input id="repo-filter" type="search" placeholder="Filter repositories" aria-label="Filter repositories" autocomplete="off" spellcheck="false">
          </div>
          <div id="repos" class="repo-list"></div>
          <p id="repo-message" class="repo-message">Loading repositories...</p>
        </div>
      </div>
```

and the result link with a card of links:

```html
    <div id="result" class="result" hidden>
      <svg class="icon result-check" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/></svg>
      <div class="result-text">
        <strong id="result-title"></strong>
        <ul id="result-links" class="result-links"></ul>
      </div>
    </div>
```

- [ ] **Step 4: Run the page test**

Run: `npm test -- test/page.test.ts`
Expected: PASS.

- [ ] **Step 5: Update `public/app.js`.**

State and storage:

```js
const MAX_REPOS = 10;
const state = { repos: [], type: "auto", note: "", fields: null, title: "", body: "" };
```

```js
  for (const key of ["note", "title", "body"]) {
    if (typeof saved[key] === "string") state[key] = saved[key];
  }
  state.repos = Array.isArray(saved.repos) ? saved.repos.filter((name) => typeof name === "string") : [];
```

Picker functions, replacing `loadRepos`:

```js
function setRepoMessage(text) {
  el("repo-message").textContent = text;
  el("repo-message").hidden = text === "";
}

function repoOption(repo) {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = repo.name;
  const name = document.createElement("span");
  name.className = "repo-name";
  name.textContent = repo.name;
  const row = document.createElement("label");
  row.className = "repo-option";
  row.append(box, name);
  if (repo.private) {
    const tag = document.createElement("span");
    tag.className = "repo-tag";
    tag.textContent = "private";
    row.append(tag);
  }
  return row;
}

// Reflects `state.repos` on the boxes; at the maximum the rest are disabled.
function syncRepos() {
  const full = state.repos.length >= MAX_REPOS;
  for (const box of el("repos").querySelectorAll("input")) {
    box.checked = state.repos.includes(box.value);
    box.disabled = full && !box.checked;
  }
  el("repo-count").textContent = `${state.repos.length} / ${MAX_REPOS} selected`;
}

function toggleRepo(box) {
  state.repos = box.checked ? [...state.repos, box.value] : state.repos.filter((name) => name !== box.value);
  saveState();
  syncRepos();
}

function filterRepos() {
  const query = el("repo-filter").value.trim().toLowerCase();
  let shown = 0;
  for (const box of el("repos").querySelectorAll("input")) {
    const match = box.value.toLowerCase().includes(query);
    box.parentElement.hidden = !match;
    if (match) shown++;
  }
  if (el("repos").children.length > 0) setRepoMessage(shown === 0 ? "No repositories match." : "");
}

async function loadRepos() {
  let repos;
  try {
    ({ repos } = await api("/api/repos"));
  } catch (error) {
    setRepoMessage("Could not load repositories.");
    throw error;
  }
  const names = new Set(repos.map((repo) => repo.name));
  state.repos = state.repos.filter((name) => names.has(name));
  saveState();
  el("repos").replaceChildren(...repos.map(repoOption));
  setRepoMessage(repos.length ? "" : "No repositories with issues enabled.");
  syncRepos();
  filterRepos();
}
```

Result and publish, replacing `publish`:

```js
function showResult(created) {
  el("result-title").textContent = created.length === 1
    ? `Issue #${created[0].number} created in ${created[0].repo}`
    : `${created.length} issues created`;
  el("result-links").replaceChildren(...created.map((issue) => {
    const link = document.createElement("a");
    link.href = issue.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = `${issue.repo} #${issue.number}`;
    const item = document.createElement("li");
    item.append(link);
    return item;
  }));
  el("result").hidden = false;
}

async function publish() {
  if (state.repos.length === 0) {
    el("repo-filter").focus();
    throw new Error("Choose at least one repository.");
  }
  if (!state.title.trim() || !state.body.trim()) throw new Error("The title and body cannot be empty.");
  setStatus("Publishing...", "busy");
  const { created, failed } = await api("/api/publish", { repos: state.repos, type: state.fields.type, title: state.title, body: state.body });
  showResult(created);
  window.scrollTo({ top: 0, behavior: "smooth" });

  // The draft stays, with only the failed repositories selected, so a retry is one click.
  if (failed.length > 0) {
    state.repos = failed.map((failure) => failure.repo);
    saveState();
    syncRepos();
    throw new Error(`Not published to ${failed.map(({ repo, error }) => `${repo} (${error})`).join(", ")}. They stay selected to retry.`);
  }
  state.note = "";
  el("note").value = "";
  updateCounter("note", "note-count");
  clearDraft();
  setStatus("Published.", "success");
}
```

In the `DOMContentLoaded` handler, drop `bind("repo", "repo", "change");` and add after `loadState();`:

```js
  syncRepos();
```

and next to the other listeners:

```js
  el("repos").addEventListener("change", (event) => toggleRepo(event.target));
  el("repo-filter").addEventListener("input", filterRepos);
```

- [ ] **Step 6: Update `public/styles.css`.**

Remove the `.select` block (`.select`, `.select select`, `.select::after`) and `select` from the three shared field selectors, which no longer match anything. Let the group heading share the label style:

```css
label, legend, .label { display: block; font-weight: 600; font-size: 0.9rem; margin: 0 0 6px; padding: 0; }
.label-row label, .label-row .label { margin: 0; }
```

Add after the field rules:

```css
/* Repository picker */

.repo-picker { border: 1px solid var(--border-strong); border-radius: 10px; background: var(--field); overflow: hidden; }

.repo-filter { display: flex; align-items: center; gap: 8px; padding: 0 12px; border-bottom: 1px solid var(--border); color: var(--muted); transition: color 150ms, box-shadow 150ms; }
.repo-filter:focus-within { color: var(--accent); box-shadow: inset 0 -2px 0 var(--accent); }
.repo-filter input { flex: 1; min-width: 0; min-height: 44px; padding: 0; border: 0; background: transparent; color: var(--text); font: inherit; }
.repo-filter input:focus { outline: none; }
.repo-filter input::placeholder { color: var(--muted); opacity: 0.8; }

.repo-list { max-height: 272px; overflow-y: auto; padding: 4px; }
.repo-list:empty { display: none; }

.repo-option { display: flex; align-items: center; gap: 10px; min-height: 44px; margin: 0; padding: 0 10px; border-radius: 8px; font-weight: 500; cursor: pointer; transition: background-color 150ms; }
.repo-option:hover { background: var(--border); }
.repo-option:has(input:checked) { background: var(--accent-soft); }
.repo-option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: -2px; }
.repo-option:has(input:disabled) { opacity: 0.55; cursor: not-allowed; }
.repo-option input { flex: none; width: 18px; height: 18px; margin: 0; accent-color: var(--accent); cursor: inherit; }
.repo-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.repo-tag { flex: none; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: 999px; color: var(--muted); font-size: 0.75rem; }
.repo-message { margin: 0; padding: 12px 14px; color: var(--muted); font-size: 0.9rem; }
```

Replace the published-issue rules from `.result` through `.result-text span`:

```css
.result {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 20px;
  padding: 14px 18px;
  border: 1px solid var(--success);
  border-radius: var(--radius);
  background: var(--success-soft);
  animation: rise 240ms ease-out;
}

.result-check { width: 26px; height: 26px; color: var(--success); }
.result-text { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.result-links { display: flex; flex-wrap: wrap; gap: 0 18px; margin: 0; padding: 0; list-style: none; }
.result-links a { display: inline-flex; align-items: center; min-height: 44px; color: var(--text); font-weight: 600; text-decoration: underline; text-decoration-color: var(--success); text-underline-offset: 3px; overflow-wrap: anywhere; }
.result-links a:hover { text-decoration-thickness: 2px; }
.result-links a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }
```

- [ ] **Step 7: Update `README.md`.** Step 1 of "How it works" becomes "Pick one or more repositories (up to ten) and write a note, as informally as you like." In Security, "daily caps on drafts (150) and publishes (50)" becomes "daily caps on drafts (150) and published issues (50)".

- [ ] **Step 8: Verify**

Run: `npm test`, `node --check public/app.js`, `npx wrangler types && npx tsc --noEmit`
Expected: all PASS.

Then `npm run dev` and check in the browser, light and dark: the list loads, the filter hides rows and shows "No repositories match.", the 11th box is disabled at 10 selected, the counter follows, the selection survives a reload, and publishing shows one link per issue (GitHub calls can be faked by stubbing `/api/publish`).

- [ ] **Step 9: Commit**

```bash
git add public/index.html public/app.js public/styles.css README.md test/page.test.ts
git commit -m "Pick several repositories on the page and list every created issue"
```
