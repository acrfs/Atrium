import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblems, usernameMatches, verifyPortal, setPortalPassword } from "./sync.mjs";
import { pageHtml, signInHtml } from "./views.mjs";
import { createSessions, readCookie, sessionCookie, SESSION_TTL_MS } from "./session.mjs";

const cfg = { portalInternalUrl: "http://atrium:8080", portalSyncToken: "x".repeat(40), portalLoginEmail: "shana@shanastudios.co" };

test("password rule matches the portal's", () => {
  assert.deepEqual(passwordProblems("abcdefgh"), []);
  assert.ok(passwordProblems("Ab1!").includes("at least 8 characters"));
  assert.ok(passwordProblems("x".repeat(129)).includes("at most 128 characters"));
  assert.ok(passwordProblems(undefined).includes("at least 8 characters"));
});

function fakePortal(reply) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) });
    return reply(url);
  };
  return { calls, fetchImpl };
}
const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });

test("verify: sends the token and login email, maps the answer", async () => {
  const { calls, fetchImpl } = fakePortal(() => json({ ok: true }));
  assert.deepEqual(await verifyPortal(cfg, "Secret123", fetchImpl), { ok: true });
  assert.equal(calls[0].url, "http://atrium:8080/api/internal/studio-sync/verify");
  assert.equal(calls[0].headers["x-studio-sync-token"], cfg.portalSyncToken);
  assert.deepEqual(calls[0].body, { loginEmail: "shana@shanastudios.co", password: "Secret123" });

  const wrong = await verifyPortal(cfg, "nope", fakePortal(() => json({ ok: false })).fetchImpl);
  assert.equal(wrong.ok, false);
  assert.equal(wrong.authFailed, true);
});

test("verify: a portal error is not reported as a wrong password", async () => {
  const r = await verifyPortal(cfg, "x", fakePortal(() => json({}, 503)).fetchImpl);
  assert.equal(r.ok, false);
  assert.equal(r.authFailed, false);
  const down = await verifyPortal(cfg, "x", async () => { throw new Error("ECONNREFUSED"); });
  assert.equal(down.authFailed, false);
});

test("set: one line for the sign-in and one for the notice", async () => {
  const { calls, fetchImpl } = fakePortal(() => json({ login: "updated", notified: true }));
  const r = await setPortalPassword(cfg, "NewSecret1", fetchImpl);
  assert.equal(calls[0].url, "http://atrium:8080/api/internal/studio-sync/password");
  assert.deepEqual(calls[0].body, { loginEmail: "shana@shanastudios.co", password: "NewSecret1" });
  assert.deepEqual(r.map((x) => x.ok), [true, true]);

  const quiet = await setPortalPassword(cfg, "NewSecret1", fakePortal(() => json({ login: "updated", notified: false })).fetchImpl);
  assert.deepEqual(quiet.map((x) => x.ok), [true, false]);

  const refused = await setPortalPassword(cfg, "NewSecret1", fakePortal(() => json({}, 403)).fetchImpl);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].ok, false);
});

test("pages mention no Titan, no website step and no address", () => {
  for (const html of [pageHtml(), pageHtml({ migrate: true }), signInHtml()]) {
    assert.doesNotMatch(html, /Titan|webmail|lead form|Vercel/i);
    assert.doesNotMatch(html, /shana@/);
  }
  assert.match(pageHtml(), /Current password/);
  assert.match(pageHtml(), /Google/);
});

test("sessions: valid until expiry, reject tampering and other keys", () => {
  let t = 1_000_000;
  const s = createSessions(Buffer.alloc(32, 1), () => t);
  const tok = s.issue();
  assert.equal(s.valid(tok), true);
  const [exp, mac] = tok.split(".");
  assert.equal(s.valid(`${Number(exp) + 999999}.${mac}`), false);
  assert.equal(s.valid(undefined), false);
  assert.equal(createSessions(Buffer.alloc(32, 2), () => t).valid(tok), false);
  t += SESSION_TTL_MS + 1;
  assert.equal(s.valid(tok), false);
});

test("cookies: read and write", () => {
  assert.equal(readCookie("a=1; sa_session=x.y; b=2", "sa_session"), "x.y");
  assert.equal(readCookie(undefined, "sa_session"), undefined);
  assert.match(sessionCookie("v", 60), /HttpOnly; Secure; SameSite=Strict; Max-Age=60/);
});

test("sign-in page asks for a username and password and shows no email", () => {
  const html = signInHtml();
  assert.match(html, /Account settings/);
  assert.match(html, /autocomplete="username"/);
  assert.match(html, /current-password/);
  assert.doesNotMatch(html, /shanastudios\.co\b(?!\/)|shana@/);
});

test("username is her address, full or short, any case", () => {
  const m = "shana@shanastudios.co";
  assert.equal(usernameMatches("shana@shanastudios.co", m), true);
  assert.equal(usernameMatches(" Shana ", m), true);
  assert.equal(usernameMatches("SHANA@ShanaStudios.co", m), true);
  assert.equal(usernameMatches("hello", m), false);
  assert.equal(usernameMatches("shana@gmail.com", m), false);
  assert.equal(usernameMatches("", m), false);
  assert.equal(usernameMatches(undefined, m), false);
});
