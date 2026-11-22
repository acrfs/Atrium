import { describe, expect, it } from "bun:test";
import { NotFoundException } from "@nestjs/common";
import { generateKeyPairSync } from "crypto";
import { GoogleSsoController, gatePage } from "./google-sso.controller";
import { GoogleSsoService } from "./google-sso.service";

const PEM: string = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const REDIRECT: string = "https://accounts.google.com/sso/oidc/callback";
const VALUES: Record<string, string> = {
  API_URL: "https://portal.example.com",
  WEB_URL: "https://portal.example.com",
  GOOGLE_SSO_CLIENT_ID: "google-workspace",
  GOOGLE_SSO_CLIENT_SECRET: "s".repeat(48),
  GOOGLE_SSO_PRIVATE_KEY: PEM,
  GOOGLE_SSO_REDIRECT_URIS: REDIRECT,
  GOOGLE_SSO_ALLOWED_DOMAINS: "shanastudios.co",
};
const QUERY = { response_type: "code", client_id: "google-workspace", redirect_uri: REDIRECT, scope: "openid email", state: "st" };
const URL_PATH = "/api/sso/google/authorize?response_type=code&client_id=google-workspace";

function controller(values: Record<string, string> = VALUES): GoogleSsoController {
  return new GoogleSsoController(new GoogleSsoService({ get: (k: string) => values[k] } as never));
}

function fakeRes() {
  const res = {
    statusCode: 200,
    location: "",
    body: "" as unknown,
    status(code: number) { res.statusCode = code; return res; },
    type() { return res; },
    send(b: unknown) { res.body = b; return res; },
    json(b: unknown) { res.body = b; return res; },
    setHeader() { return res; },
    redirect(code: number, url: string) { res.statusCode = code; res.location = url; return res; },
  };
  return res;
}

const shana = { id: "u1", email: "shana@shanastudios.co", name: "Shana", twoFactorEnabled: false, hasPasskey: false };
const session = { createdAt: new Date("2026-11-22T00:00:00Z"), secondFactor: null };

describe("gatePage", () => {
  it("sends a user with a factor that this session has not passed to the code screen", () => {
    expect(gatePage({ originalUrl: "/", user: { ...shana, twoFactorEnabled: true } as never, session: session as never })).toBe("/login/2fa");
    expect(gatePage({ originalUrl: "/", user: { ...shana, twoFactorEnabled: true } as never, session: { ...session, secondFactor: "totp" } as never })).toBeNull();
  });

  it("sends staff who owe 2FA setup to setup", () => {
    expect(gatePage({ originalUrl: "/", user: shana as never, session: session as never, workspaceRequiresTwoFactor: true, member: { role: "owner" } as never })).toBe("/2fa/setup");
    expect(gatePage({ originalUrl: "/", user: shana as never, session: session as never })).toBeNull();
  });
});

describe("GoogleSsoController", () => {
  it("answers 404 when Google SSO is not configured", () => {
    expect(() => controller({ API_URL: "https://x" }).discovery()).toThrow(NotFoundException);
  });

  it("sends a signed-out browser to the portal login and back", () => {
    const res = fakeRes();
    controller().authorize(QUERY, { originalUrl: URL_PATH }, res as never);
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe(`https://portal.example.com/login?next=${encodeURIComponent(URL_PATH)}`);
  });

  it("issues a code straight away when the portal session is signed in", () => {
    const res = fakeRes();
    controller().authorize(QUERY, { originalUrl: URL_PATH, user: shana as never, session: session as never }, res as never);
    const back = new URL(res.location);
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT);
    expect(back.searchParams.get("code")).toBeTruthy();
    expect(back.searchParams.get("state")).toBe("st");
  });

  it("returns access_denied for portal users outside the allowed domains", () => {
    const res = fakeRes();
    controller().authorize(QUERY, { originalUrl: URL_PATH, user: { ...shana, email: "client@gmail.com" } as never, session: session as never }, res as never);
    expect(new URL(res.location).searchParams.get("error")).toBe("access_denied");
  });

  it("never redirects to an unregistered URI", () => {
    const res = fakeRes();
    controller().authorize({ ...QUERY, redirect_uri: "https://evil.example/cb" }, { originalUrl: URL_PATH, user: shana as never, session: session as never }, res as never);
    expect(res.statusCode).toBe(400);
    expect(res.location).toBe("");
  });
});
