import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { GOOGLE_SSO_CLIENT_ID, GOOGLE_SSO_CLIENT_SECRET, GOOGLE_SSO_REDIRECT_URI } from "../playwright.config";
import { createOwner } from "./helpers";

const API = "http://localhost:3001/api";
const ISSUER_PATH = "/api/sso/google";

// Google Workspace's third-party SSO profile sends a user to the portal to
// sign in; the portal answers with an RS256 id_token for that user's email.

function authorizeUrl(state: string, challenge: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: GOOGLE_SSO_CLIENT_ID,
    redirect_uri: GOOGLE_SSO_REDIRECT_URI,
    scope: "openid email profile",
    state,
    nonce: `nonce-${state}`,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `${API}/sso/google/authorize?${q.toString()}`;
}

/**
 * Resolves with the query of the portal's 302 back to Google's callback.
 * Playwright does not route redirected requests, so read the Location header.
 */
function nextCallback(page: Page): Promise<URLSearchParams> {
  return page
    .waitForResponse(
      (r) => r.url().includes("/sso/google/authorize") && r.status() === 302 && (r.headers()["location"] ?? "").startsWith(GOOGLE_SSO_REDIRECT_URI),
      { timeout: 20000 },
    )
    .then((r) => new URL(r.headers()["location"]).searchParams);
}

test.describe("Google Workspace SSO through the portal", () => {
  test.beforeEach(async ({ request }) => {
    const res = await request.get(`${API}/sso/google/.well-known/openid-configuration`);
    test.skip(res.status() === 404, "API was started without GOOGLE_SSO_* (reused dev server)");
  });

  test("publishes OIDC discovery and an RS256 key", async ({ request }) => {
    const doc = await (await request.get(`${API}/sso/google/.well-known/openid-configuration`)).json();
    expect(doc.issuer).toMatch(new RegExp(`${ISSUER_PATH}$`));
    expect(doc.id_token_signing_alg_values_supported).toEqual(["RS256"]);
    const jwks = await (await request.get(`${API}/sso/google/jwks`)).json();
    expect(jwks.keys[0]).toMatchObject({ kty: "RSA", alg: "RS256", use: "sig" });
    expect(jwks.keys[0].d).toBeUndefined();
  });

  test("a signed-out user signs in on the portal and Google gets her identity", async ({ browser, request }) => {
    const { context: ownerContext, email, password } = await createOwner(browser, "gsso");
    await ownerContext.close();

    const ctx = await browser.newContext({ storageState: undefined });
    const page: Page = await ctx.newPage();
    const verifier = `verifier-${Date.now()}-abcdefghijklmnopqrstuvwxyz0123456789`;
    const challenge = createHash("sha256").update(verifier).digest("base64url");

    // Signed out: the portal login page, with the authorize request carried in ?next=.
    await page.goto(authorizeUrl("s1", challenge));
    await expect(page).toHaveURL(/\/login\?next=/, { timeout: 20000 });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    const callback = nextCallback(page);
    await page.getByRole("button", { name: /sign in/i }).click();
    const back = await callback;
    expect(back.get("state")).toBe("s1");
    const code = back.get("code");
    expect(code).toBeTruthy();

    // Google's server redeems the code.
    const token = await request.post(`${API}/sso/google/token`, {
      form: { grant_type: "authorization_code", code: code!, redirect_uri: GOOGLE_SSO_REDIRECT_URI, code_verifier: verifier },
      headers: { authorization: `Basic ${Buffer.from(`${GOOGLE_SSO_CLIENT_ID}:${GOOGLE_SSO_CLIENT_SECRET}`).toString("base64")}` },
    });
    expect(token.status()).toBe(200);
    const body = await token.json();
    const claims = JSON.parse(Buffer.from(body.id_token.split(".")[1], "base64url").toString("utf8"));
    expect(claims).toMatchObject({ aud: GOOGLE_SSO_CLIENT_ID, email: email.toLowerCase(), email_verified: true, nonce: "nonce-s1" });

    // Single use.
    const again = await request.post(`${API}/sso/google/token`, {
      form: { grant_type: "authorization_code", code: code!, redirect_uri: GOOGLE_SSO_REDIRECT_URI, code_verifier: verifier, client_id: GOOGLE_SSO_CLIENT_ID, client_secret: GOOGLE_SSO_CLIENT_SECRET },
    });
    expect(again.status()).toBe(400);

    // Already signed in to the portal: straight back to Google, no login page.
    const secondCallback = nextCallback(page);
    await page.goto(authorizeUrl("s2", challenge)).catch(() => undefined);
    const second = await secondCallback;
    expect(second.get("state")).toBe("s2");
    expect(second.get("code")).toBeTruthy();
    await ctx.close();
  });

  test("an unregistered redirect URI is refused without a redirect", async ({ request }) => {
    const res = await request.get(
      `${API}/sso/google/authorize?response_type=code&client_id=${GOOGLE_SSO_CLIENT_ID}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&scope=openid`,
      { maxRedirects: 0 },
    );
    expect(res.status()).toBe(400);
  });
});
