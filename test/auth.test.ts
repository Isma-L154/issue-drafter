import { beforeAll, describe, expect, it } from "vitest";
import { createAccessVerifier } from "../src/auth.ts";
import type { Fetch } from "../src/github.ts";

const TEAM = "example.cloudflareaccess.com";
const AUD = "aud-tag";
const NOW = new Date("2026-09-12T12:00:00Z");
const nowSeconds = Math.floor(NOW.getTime() / 1000);

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const encodeJson = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JsonWebKey;

async function rsaPair() {
  return (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
}

beforeAll(async () => {
  const pair = await rsaPair();
  signingKey = pair.privateKey;
  publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  otherKey = (await rsaPair()).privateKey;
});

async function token(payload: Record<string, unknown>, options: { kid?: string; alg?: string; key?: CryptoKey } = {}) {
  const header = encodeJson({ alg: options.alg ?? "RS256", kid: options.kid ?? "k1" });
  const body = encodeJson(payload);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", options.key ?? signingKey, new TextEncoder().encode(`${header}.${body}`));
  return `${header}.${body}.${b64url(new Uint8Array(signature))}`;
}

const claims = (extra: Record<string, unknown> = {}) => ({
  aud: [AUD], iss: `https://${TEAM}`, exp: nowSeconds + 300, email: "owner@example.com", ...extra,
});

function certs(kids: string[] = ["k1"]) {
  let calls = 0;
  const fetcher: Fetch = async (url) => {
    calls++;
    expect(url).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: kids.map((kid) => ({ ...publicJwk, kid })) });
  };
  return { fetcher, calls: () => calls };
}

describe("createAccessVerifier", () => {
  it("returns the email of a valid token and caches the key set", async () => {
    const { fetcher, calls } = certs();
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, fetcher);
    expect(await verify(await token(claims()), NOW)).toBe("owner@example.com");
    expect(await verify(await token(claims()), NOW)).toBe("owner@example.com");
    expect(calls()).toBe(1);
  });

  it("accepts aud as a string", async () => {
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, certs().fetcher);
    expect(await verify(await token(claims({ aud: AUD })), NOW)).toBe("owner@example.com");
  });

  it.each([
    ["wrong audience", claims({ aud: ["other"] })],
    ["wrong issuer", claims({ iss: "https://evil.cloudflareaccess.com" })],
    ["expired", claims({ exp: nowSeconds - 1 })],
    ["not yet valid", claims({ nbf: nowSeconds + 60 })],
    ["no email", claims({ email: "" })],
  ])("rejects a token with %s", async (_label, payload) => {
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, certs().fetcher);
    expect(await verify(await token(payload), NOW)).toBeNull();
  });

  it("rejects a token signed by another key", async () => {
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, certs().fetcher);
    expect(await verify(await token(claims(), { key: otherKey }), NOW)).toBeNull();
  });

  it("rejects any algorithm other than RS256", async () => {
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, certs().fetcher);
    expect(await verify(await token(claims(), { alg: "none" }), NOW)).toBeNull();
  });

  it("refetches a cached key set once for an unknown kid", async () => {
    const { fetcher, calls } = certs(["k1"]);
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, fetcher);
    expect(await verify(await token(claims()), NOW)).toBe("owner@example.com");
    expect(calls()).toBe(1);
    expect(await verify(await token(claims(), { kid: "rotated" }), NOW)).toBeNull();
    expect(calls()).toBe(2);
  });

  it("fails closed without configuration, token or structure", async () => {
    const { fetcher, calls } = certs();
    expect(await createAccessVerifier({ teamDomain: "", aud: AUD }, fetcher)(await token(claims()), NOW)).toBeNull();
    expect(await createAccessVerifier({ teamDomain: TEAM, aud: "" }, fetcher)(await token(claims()), NOW)).toBeNull();
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, fetcher);
    expect(await verify(null, NOW)).toBeNull();
    expect(await verify("not.a-token", NOW)).toBeNull();
    expect(calls()).toBe(0);
  });

  it("fails closed when the key set cannot be fetched", async () => {
    const verify = createAccessVerifier({ teamDomain: TEAM, aud: AUD }, async () => new Response("down", { status: 500 }));
    expect(await verify(await token(claims()), NOW)).toBeNull();
  });
});
