// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
// Generated types declare the global `Env` and `Cloudflare.Env` separately, so
// the secret is added to both.
interface Env {
  GITHUB_TOKEN: string;
}

declare namespace Cloudflare {
  interface Env {
    GITHUB_TOKEN: string;
  }
}
