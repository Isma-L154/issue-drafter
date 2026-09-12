# Issue Drafter - Design

## Purpose

Write a GitHub issue from anywhere, in Spanish and in informal words, and have
it published in English following one fixed template, to a repository chosen
from a list.

## Constraints

- **No cost.** Cloudflare Workers Free plan and the Workers AI daily free
  allocation (10,000 Neurons, reset at 00:00 UTC). On the Free plan exhausting
  the allocation fails with an error; it never bills.
- **Owner only.** Nobody else can draft or publish.
- **The model never invents facts.** Versions, numbers, file names and
  reproduction steps appear only if the note contains them.
- Everything in the repository is in English.

## Measured viability (2026-09-12)

The same Spanish bug note was run through three models with a JSON-fields
prompt:

| Model | Latency | Neurons | Notes |
|---|---|---|---|
| `@cf/qwen/qwen3-30b-a3b-fp8` | 4.3 s | 17.8 | Correct type, clean JSON |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 3.0 s | 40.2 | Wrong type, JSON wrapped in a code fence |
| `@cf/openai/gpt-oss-120b` | 16.2 s | 53.9 | Best prose, invented an acceptance criterion |

All three invented reproduction steps the note did not contain. That is why
the preview is mandatory and why unknowns become open questions.

**Chosen model:** `@cf/qwen/qwen3-30b-a3b-fp8`, roughly 500 drafts a day
inside the free allocation. It is not on the JSON Mode list, so output is
validated in code rather than trusted.

## Architecture

One Worker, `issue-drafter`, served at `issues.cloudils.com` as a custom
domain, with `workers_dev` and preview URLs disabled.

```
Browser -> Cloudflare Access -> Worker
                                 GET  /              static page (assets)
                                 GET  /api/health    liveness, no auth data
                                 GET  /api/repos     repositories that accept issues
                                 POST /api/draft     note -> Workers AI -> draft
                                 POST /api/publish   draft -> GitHub issue
```

### Units

| Unit | Responsibility | Depends on |
|---|---|---|
| `schema.ts` | Types and validation of the model's fields per issue type | nothing |
| `render.ts` | Fields -> `{ title, body, labels }`. Pure, deterministic | `schema.ts` |
| `prompt.ts` | Builds the system and user messages, including corrections | `schema.ts` |
| `ai.ts` | Calls the model, extracts JSON, validates, retries once | `prompt.ts`, `schema.ts` |
| `github.ts` | Lists repositories, ensures a label exists, creates an issue | `fetch` |
| `auth.ts` | Verifies the Cloudflare Access JWT | `fetch` (JWKS) |
| `limits.ts` | Per-minute rate limits and daily caps | Rate Limiting bindings, KV |
| `index.ts` | Routing, request validation, error mapping | all of the above |

## The template

Three issue types. The model returns fields; `render.ts` writes the Markdown,
so the structure never depends on the model. Optional sections that are empty
are omitted. `Summary`/`Goal` and acceptance criteria are always present.

**Bug** - title describes the failure. Label `bug`.

```
## Summary
## Steps to reproduce        (only if given)
## Expected behavior
## Actual behavior
## Impact                    (only if given)
## Acceptance criteria
- [ ] ...
## Open questions            (what the note left unclear)
```

**Feature** - imperative title. Label `enhancement`.

```
## Goal
## Context                   (only if given)
## Proposed behavior
## Acceptance criteria
- [ ] ...
## Out of scope              (only if given)
## Open questions
```

**Task** - refactor, cleanup, investigation. Imperative title. Label `task`,
created in the repository if missing.

```
## Goal
## Context                   (only if given)
## Scope
- [ ] ...
## Acceptance criteria
- [ ] ...
## Out of scope              (only if given)
## Open questions
```

The same template and English output apply to every repository, including
those that have their own `.github/ISSUE_TEMPLATE`.

## Flow

1. Pick a repository and a type (`auto`, `bug`, `feature`, `task`).
2. Write the note in Spanish; **Generate** calls `/api/draft`.
3. The preview shows title and body, both editable.
4. **Correct** sends the note, the current draft and a Spanish instruction to
   `/api/draft`, which regenerates from them.
5. **Publish** calls `/api/publish` and shows the issue link.

The note and draft are kept in `localStorage` so a failure never loses them.

## Security

- **Cloudflare Access** on `issues.cloudils.com`, same email policy as the
  server panel.
- **The Worker verifies the Access JWT** (`Cf-Access-Jwt-Assertion`) on every
  `/api/*` request except `/api/health`: RS256 signature against the team's
  JWKS, `aud` equal to `ACCESS_AUD`, `iss` equal to the team domain, not
  expired. A misconfigured or removed Access application fails closed.
- **GitHub fine-grained token** limited to the owner's repositories, with
  `Issues: read and write` and `Metadata: read` only. Stored as the Worker
  secret `GITHUB_TOKEN`.
- **Rate limiting:** per-minute Rate Limiting bindings keyed by the Access
  identity (drafts 10/min, publishes 5/min) and daily caps in KV (150 drafts,
  50 publishes). 150 drafts at the worst observed cost stay under the free
  allocation. Every limit is verified by provoking it.
- **CSRF:** `POST` requires `Content-Type: application/json` and an `Origin`
  equal to the site.
- **Input bounds:** note and correction up to 4,000 characters; repository must
  be in the list the token can reach.
- **No note or draft content is ever logged.**
- **Response headers:** strict CSP, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `frame-ancestors 'none'`.
- **CI:** typecheck, tests, a check for accented characters outside test
  fixtures, and a credential-pattern scan. Actions pinned by digest.

## Error handling

| Failure | Behavior |
|---|---|
| Model output is not valid JSON or fails validation | Retry once, then `502` with a clear message |
| Daily cap or Workers AI allocation exhausted | `429` naming the reset time (00:00 UTC) |
| Per-minute rate limit | `429` with `Retry-After` |
| GitHub `401`/`403` | `502` stating the token is invalid or lacks permission |
| GitHub `404`/`410` | `400` stating the repository is unavailable or has issues disabled |
| GitHub `422` | `400` with GitHub's validation message |
| Missing or invalid Access JWT | `403`, no detail |

## Testing

- Unit tests for `schema.ts`, `render.ts` and `prompt.ts`.
- Worker tests in workerd (`@cloudflare/vitest-pool-workers`,
  `remoteBindings: false`) with the AI binding and GitHub `fetch` mocked:
  routing, auth, CSRF, bounds, error mapping, limits.
- `scripts/eval.ts`, run by hand against the real model with a fixed set of
  Spanish notes, reports invented facts and schema failures. Not in CI: it
  spends allocation.
- After deploy, CI verifies `/api/health` and that `/api/repos` without Access
  is refused.

## Manual steps for the owner

1. Create the fine-grained GitHub token and store it with
   `wrangler secret put GITHUB_TOKEN`.
2. Create the Access application for `issues.cloudils.com` and provide its
   team domain and AUD tag as Worker variables.
3. Create a `CLOUDFLARE_API_TOKEN` repository secret for the deploy workflow.

## Out of scope

- Voice input (phone keyboards already dictate).
- Editing or commenting on existing issues.
- Multiple users.
