import type { Fetch } from "./github.ts";

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

export type AccessVerifier = (token: string | null, now: Date) => Promise<string | null>;

type KeyWithId = JsonWebKey & { kid?: string };

function decodeSegment(segment: string): Uint8Array {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(decodeSegment(segment)));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createAccessVerifier(config: AccessConfig, fetcher: Fetch = (input, init) => fetch(input, init)): AccessVerifier {
  let keys: KeyWithId[] | null = null;

  async function loadKeys(): Promise<KeyWithId[]> {
    const response = await fetcher(`https://${config.teamDomain}/cdn-cgi/access/certs`);
    if (!response.ok) return [];
    const body = (await response.json()) as { keys?: KeyWithId[] };
    keys = Array.isArray(body.keys) ? body.keys : [];
    return keys;
  }

  // Loads the set on first use; a kid missing from an already cached set
  // triggers one reload, which is how a rotated signing key gets picked up.
  async function findKey(kid: string): Promise<KeyWithId | undefined> {
    if (keys === null) return (await loadKeys()).find((key) => key.kid === kid);
    return keys.find((key) => key.kid === kid) ?? (await loadKeys()).find((key) => key.kid === kid);
  }

  return async (token, now) => {
    if (!config.teamDomain || !config.aud || !token) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

    const header = decodeJson(headerPart);
    const payload = decodeJson(payloadPart);
    if (!header || !payload || header["alg"] !== "RS256" || typeof header["kid"] !== "string") return null;

    try {
      const jwk = await findKey(header["kid"]);
      if (!jwk) return null;
      const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decodeSegment(signaturePart),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`),
      );
      if (!valid) return null;
    } catch {
      return null;
    }

    const seconds = Math.floor(now.getTime() / 1000);
    const audiences = Array.isArray(payload["aud"]) ? payload["aud"] : [payload["aud"]];
    if (!audiences.includes(config.aud)) return null;
    if (payload["iss"] !== `https://${config.teamDomain}`) return null;
    if (typeof payload["exp"] !== "number" || payload["exp"] <= seconds) return null;
    if (typeof payload["nbf"] === "number" && payload["nbf"] > seconds) return null;
    const email = payload["email"];
    return typeof email === "string" && email !== "" ? email : null;
  };
}
