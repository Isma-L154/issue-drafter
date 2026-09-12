<p align="center">
  <img src="public/logo.svg" width="72" height="72" alt="">
</p>

<h1 align="center">Issue Drafter</h1>

<p align="center">
  Write an issue in your own words, in Spanish. Publish it in English, following one template.
</p>

<p align="center">
  <a href="https://github.com/Isma-L154/issue-drafter/actions/workflows/ci.yml"><img src="https://github.com/Isma-L154/issue-drafter/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/Isma-L154/issue-drafter/actions/workflows/deploy.yml"><img src="https://github.com/Isma-L154/issue-drafter/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

## How it works

1. Pick a repository and write a note, as informally as you like.
2. Workers AI turns the note into issue fields. Code, not the model, renders
   them into the template, so every issue has the same structure.
3. Review the preview, ask for a correction in plain words, and publish.

Three templates, chosen automatically or by hand:

| Type | Sections | Label |
|---|---|---|
| Bug | Summary, Steps to reproduce, Expected, Actual, Impact, Acceptance criteria, Open questions | `bug` |
| Feature | Goal, Context, Proposed behavior, Acceptance criteria, Out of scope, Open questions | `enhancement` |
| Task | Goal, Context, Scope, Acceptance criteria, Out of scope, Open questions | `task` |

Empty optional sections are left out. Anything the note does not say becomes
an open question instead of an invented detail.

## Stack

- **Cloudflare Workers** with static assets, KV and Rate Limiting
- **Workers AI** (`@cf/qwen/qwen3-30b-a3b-fp8`)
- **Cloudflare Access** in front of the site
- **GitHub REST API** with a fine-grained token
- TypeScript, Vitest in `workerd`

Everything runs on free tiers.

## Security

- Cloudflare Access guards the site, and the Worker verifies the Access JWT on
  every API call, so a misconfigured Access application fails closed.
- The GitHub token can only read and write issues.
- Per-minute rate limits on every GitHub or model call, checked before the call,
  and daily caps on drafts (150) and publishes (50).
- Same-origin JSON requests only, bodies capped at 64 KB while they stream.
- Strict Content Security Policy and HSTS.
- Missing configuration answers 500 everywhere, health included, so a broken
  deploy fails its verification.
- Note and draft contents are never logged.

## Development

```sh
npm install
npm run typecheck
npm test
npm run eval   # runs sample notes against the real model; needs CLOUDFLARE_API_TOKEN
```

## Configuration

| Name | Kind | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | Worker secret | Fine-grained token with Issues read and write |
| `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` | Worker vars | The Access application the JWT must belong to |
| `DAILY_DRAFT_CAP`, `DAILY_PUBLISH_CAP` | Worker vars | Daily limits |
| `CLOUDFLARE_API_TOKEN` | Repository secret | Used by the deploy workflow |

Pushes to `main` deploy automatically once CI passes.

## License

[MIT](LICENSE)
