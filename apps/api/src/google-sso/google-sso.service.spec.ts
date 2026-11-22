import { describe, expect, it } from "bun:test";
import { createHash, generateKeyPairSync, verify } from "crypto";
import { decodePrivateKey, loadGoogleSsoConfig, splitList } from "./google-sso.config";
import { ExpiringStore } from "./google-sso.store";
import { GoogleSsoService, type AuthorizeQuery } from "./google-sso.service";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM: string = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const SECRET: string = "s".repeat(48);
const REDIRECT: string = "https://accounts.google.com/sso/oidc/callback";

function configOf(values: Record<string, string | undefined>): { get: (k: string) => string | undefined } {
  return { get: (k: string) => values[k] };
}

const BASE: Record<string, string> = {
  API_URL: "https://portal.example.com",
  WEB_URL: "https://portal.example.com",
  GOOGLE_SSO_CLIENT_ID: "google-workspace",
  GOOGLE_SSO_CLIENT_SECRET: SECRET,
  GOOGLE_SSO_PRIVATE_KEY: Buffer.from(PEM).toString("base64"),
  GOOGLE_SSO_REDIRECT_URIS: REDIRECT,
  GOOGLE_SSO_ALLOWED_DOMAINS: "shanastudios.co",
};

function service(overrides: Record<string, string | undefined> = {}): GoogleSsoService {
  return new GoogleSsoService(configOf({ ...BASE, ...overrides }) as never);
}

const QUERY: AuthorizeQuery = {
  response_type: "code",
  client_id: "google-workspace",
  redirect_uri: REDIRECT,
  scope: "openid email profile",
  state: "st",
  nonce: "n-123",
};

const USER = { id: "user-1", email: "Shana@ShanaStudios.co", name: "Shana Thomas" };

function codeFrom(location: string): string {
  return new URL(location).searchParams.get("code") as string;
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

describe("google sso config", () => {
  it("is off unless every required value is set", () => {
    expect(loadGoogleSsoConfig(configOf(BASE))).not.toBeNull();
    for (const key of ["GOOGLE_SSO_CLIENT_ID", "GOOGLE_SSO_CLIENT_SECRET", "GOOGLE_SSO_PRIVATE_KEY", "GOOGLE_SSO_ALLOWED_DOMAINS"]) {
      expect(loadGoogleSsoConfig(configOf({ ...BASE, [key]: undefined }))).toBeNull();
    }
  });

  it("refuses a short client secret", () => {
    expect(loadGoogleSsoConfig(configOf({ ...BASE, GOOGLE_SSO_CLIENT_SECRET: "short" }))).toBeNull();
  });

  it("accepts a PEM with escaped newlines or base64", () => {
    expect(decodePrivateKey(PEM.replace(/\n/g, "\\n")).asymmetricKeyType).toBe("rsa");
    expect(decodePrivateKey(Buffer.from(PEM).toString("base64")).asymmetricKeyType).toBe("rsa");
  });

  it("splits lists on commas and spaces", () => {
    expect(splitList(" a, b  c ,")).toEqual(["a", "b", "c"]);
  });

  it("an unusable key leaves the provider off instead of crashing", () => {
    expect(service({ GOOGLE_SSO_PRIVATE_KEY: "not a key" }).enabled).toBe(false);
  });
});

describe("expiring store", () => {
  it("hands a code out once and forgets expired entries", () => {
    let now = 1000;
    const store = new ExpiringStore<string>(100, () => now);
    const a = store.issue("a");
    expect(store.take(a)).toBe("a");
    expect(store.take(a)).toBeUndefined();
    const b = store.issue("b");
    now += 101;
    expect(store.peek(b)).toBeUndefined();
  });
});

describe("GoogleSsoService", () => {
  it("publishes discovery under the issuer and an RS256 key", () => {
    const sso = service();
    const doc = sso.discovery();
    expect(doc.issuer).toBe("https://portal.example.com/api/sso/google");
    expect(doc.token_endpoint).toBe("https://portal.example.com/api/sso/google/token");
    expect(doc.id_token_signing_alg_values_supported).toEqual(["RS256"]);
    const [key] = sso.jwks().keys as Array<Record<string, string>>;
    expect(key.alg).toBe("RS256");
    expect(key.kid).toBeTruthy();
    expect(key).not.toHaveProperty("d");
  });

  it("refuses unknown clients and redirect URIs without redirecting", () => {
    const sso = service();
    expect(sso.checkAuthorize({ ...QUERY, client_id: "other" })).toEqual({ kind: "bad_client" });
    expect(sso.checkAuthorize({ ...QUERY, redirect_uri: "https://evil.example/cb" })).toEqual({ kind: "bad_redirect" });
    expect(sso.checkAuthorize({ ...QUERY, response_type: "token" })?.kind).toBe("redirect_error");
    expect(sso.checkAuthorize({ ...QUERY, scope: "email" })?.kind).toBe("redirect_error");
    expect(sso.checkAuthorize({ ...QUERY, code_challenge: "x", code_challenge_method: "plain" })?.kind).toBe("redirect_error");
    expect(sso.checkAuthorize(QUERY)).toBeNull();
  });

  it("allows only the configured email domains", () => {
    const sso = service();
    expect(sso.isAllowed("shana@ShanaStudios.co")).toBe(true);
    expect(sso.isAllowed("aaron@example.com")).toBe(false);
  });

  it("exchanges a code for a verifiable id_token with the user's email", () => {
    const sso = service();
    const location = sso.issueCode(QUERY, USER, 1_700_000_000);
    expect(new URL(location).searchParams.get("state")).toBe("st");
    const basic = `Basic ${Buffer.from(`google-workspace:${SECRET}`).toString("base64")}`;
    const result = sso.exchange({ grant_type: "authorization_code", code: codeFrom(location), redirect_uri: REDIRECT }, basic);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [h, p, s] = (result.body.id_token as string).split(".");
    expect(verify("sha256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
    expect(decode(h)).toMatchObject({ alg: "RS256", kid: (sso.jwks().keys[0] as { kid: string }).kid });
    const claims = decode(p);
    expect(claims).toMatchObject({
      iss: "https://portal.example.com/api/sso/google",
      aud: "google-workspace",
      sub: "user-1",
      email: "shana@shanastudios.co",
      email_verified: true,
      nonce: "n-123",
      auth_time: 1_700_000_000,
    });
    expect(sso.userinfo(`Bearer ${result.body.access_token as string}`)).toMatchObject({ sub: "user-1", email: "shana@shanastudios.co" });
  });

  it("accepts client_secret_post and refuses a reused code", () => {
    const sso = service();
    const code = codeFrom(sso.issueCode(QUERY, USER, 1));
    const body = { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "google-workspace", client_secret: SECRET };
    expect(sso.exchange(body, undefined).ok).toBe(true);
    const again = sso.exchange(body, undefined);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("invalid_grant");
  });

  it("refuses a wrong secret, a different redirect URI, and a bad PKCE verifier", () => {
    const sso = service();
    const code = codeFrom(sso.issueCode(QUERY, USER, 1));
    const wrong = sso.exchange({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: "google-workspace", client_secret: "x".repeat(48) }, undefined);
    expect(wrong.ok === false && wrong.status).toBe(401);

    const code2 = codeFrom(sso.issueCode(QUERY, USER, 1));
    const other = sso.exchange({ grant_type: "authorization_code", code: code2, redirect_uri: `${REDIRECT}?x=1`, client_id: "google-workspace", client_secret: SECRET }, undefined);
    expect(other.ok === false && other.error).toBe("invalid_grant");

    const verifier = "v".repeat(50);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const pkceQuery = { ...QUERY, code_challenge: challenge, code_challenge_method: "S256" };
    const bad = sso.exchange({ grant_type: "authorization_code", code: codeFrom(sso.issueCode(pkceQuery, USER, 1)), redirect_uri: REDIRECT, client_id: "google-workspace", client_secret: SECRET, code_verifier: "nope" }, undefined);
    expect(bad.ok).toBe(false);
    const good = sso.exchange({ grant_type: "authorization_code", code: codeFrom(sso.issueCode(pkceQuery, USER, 1)), redirect_uri: REDIRECT, client_id: "google-workspace", client_secret: SECRET, code_verifier: verifier }, undefined);
    expect(good.ok).toBe(true);
  });

  it("rejects unknown bearer tokens at userinfo", () => {
    expect(service().userinfo("Bearer nope")).toBeNull();
    expect(service().userinfo(undefined)).toBeNull();
  });
});
