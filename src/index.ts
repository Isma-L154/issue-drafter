import { draftIssue, type TextModel } from "./ai.ts";
import { createAccessVerifier, type AccessVerifier } from "./auth.ts";
import { GitHubClient } from "./github.ts";
import { handle } from "./handler.ts";
import { createLimits } from "./limits.ts";

// Kept across requests in the same isolate so the Access key set is cached.
let cachedVerifier: { config: string; verify: AccessVerifier } | undefined;

function verifierFor(env: Env): AccessVerifier {
  const config = `${env.ACCESS_TEAM_DOMAIN}|${env.ACCESS_AUD}`;
  if (cachedVerifier?.config !== config) {
    cachedVerifier = { config, verify: createAccessVerifier({ teamDomain: env.ACCESS_TEAM_DOMAIN, aud: env.ACCESS_AUD }) };
  }
  return cachedVerifier.verify;
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const verify = verifierFor(env);
    return handle(request, {
      verify: (req) => verify(req.headers.get("cf-access-jwt-assertion"), new Date()),
      // The binding's overloads are keyed by model name; the model is configuration here.
      draft: (input) => draftIssue(env.AI as unknown as TextModel, env.MODEL, input),
      github: new GitHubClient(env.GITHUB_TOKEN, env.GITHUB_OWNER),
      limits: createLimits({
        draftLimiter: env.DRAFT_LIMITER,
        publishLimiter: env.PUBLISH_LIMITER,
        store: env.USAGE,
        draftCap: Number(env.DAILY_DRAFT_CAP),
        publishCap: Number(env.DAILY_PUBLISH_CAP),
      }),
      now: () => new Date(),
      siteOrigin: env.SITE_ORIGIN,
    });
  },
} satisfies ExportedHandler<Env>;
