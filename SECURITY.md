# Security policy

## Reporting a vulnerability

Open a private security advisory on the repository, or email the maintainer.
Please do not file a public issue.

## Baseline security controls

1. **Secrets in environment variables — implemented.** `GITHUB_TOKEN` is a Worker secret, never in `wrangler.jsonc`; `.dev.vars.example` lists the key without a value and `.dev.vars` is git-ignored. Any missing required setting makes every API route, health included, answer 500 (`src/index.ts`).
2. **CORS — implemented.** No CORS headers are sent, so browsers keep the API same-origin, and every POST must carry `Origin` equal to `SITE_ORIGIN` with a JSON content type (`src/handler.ts`).
3. **Backend validation — implemented.** Request bodies are capped at 64 KB while they stream and must be a JSON object; the handler reads only the fields it knows and rejects a wrong type, an empty required field or an oversized value with 400 (`src/handler.ts`). Repository names must belong to the configured owner, at most ten. The model's output is validated against `src/schema.ts` before it is rendered.
4. **Sanitize before storage — implemented.** There is no database; KV holds only daily counters under fixed keys. Issue bodies are rendered by code from validated fields, URLs are checked against the note, and the page writes model output with `textContent`, never as HTML.
5. **Rate limiting — implemented.** Per-minute limits on drafting (10), publishing (5) and listing repositories (20), keyed by the Access identity and checked before each GitHub or model call, plus daily caps on drafts and published issues.
6. **Row Level Security — N/A.** There is no database and no multi-user data: one owner, behind Cloudflare Access, publishing to their own repositories.
7. **Content Security Policy — implemented.** The page is served with `default-src 'self'`, `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'` and no inline code (`public/_headers`), API responses with `default-src 'none'; frame-ancestors 'none'`, and both with HSTS, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
