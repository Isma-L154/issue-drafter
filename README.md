# Issue Drafter

A private page that turns an informal note, written in Spanish, into an English
GitHub issue that follows one fixed template, and publishes it to a chosen
repository.

Design: `docs/superpowers/specs/2026-09-12-issue-drafter-design.md`.

## How it works

- Cloudflare Access guards `issues.cloudils.com`; the Worker also verifies the
  Access JWT on every API call.
- Workers AI (`@cf/qwen/qwen3-30b-a3b-fp8`) returns issue fields as JSON.
  Code validates them and renders the template, so the format never depends on
  the model.
- A fine-grained GitHub token with Issues access creates the issue.
- Everything runs on free tiers. Drafts are capped at 150 a day and publishes
  at 50, far inside the 10,000 daily Neurons.

## Development

```powershell
npm install
npm run typecheck
npm test
npm run eval   # real model, spends Neurons; needs CLOUDFLARE_API_TOKEN
```

## Configuration

| Name | Kind | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | secret | Fine-grained token: Issues read/write, Metadata read |
| `ACCESS_TEAM_DOMAIN` | var | `<team>.cloudflareaccess.com` |
| `ACCESS_AUD` | var | AUD tag of the Access application |
| `DAILY_DRAFT_CAP`, `DAILY_PUBLISH_CAP` | var | Daily limits |
| `CLOUDFLARE_API_TOKEN` | GitHub secret | Used by the deploy workflow |

The GitHub token expires; when publishing starts answering "GitHub rejected
the token", create a new one and run `npx wrangler secret put GITHUB_TOKEN`.
