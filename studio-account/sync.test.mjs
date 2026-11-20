import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblems, syncVercel, syncPortal } from "./sync.mjs";
import { pageHtml, emailHtml } from "./views.mjs";

const cfg = { vercelToken: "t", vercelTeam: "acrfs-projects", vercelProject: "shana-studios", vercelEnvKey: "SMTP_PASS",
  portalInternalUrl: "http://atrium:8080", portalSyncToken: "x".repeat(40), portalLoginEmail: "shana@shanastudios.co",
  mailbox: "shana@shanastudios.co", webmailUrl: "https://hostinger.titan.email/mail/" };

test("password rule matches Titan's", () => {
  assert.deepEqual(passwordProblems("Abcdef1!"), []);
  assert.ok(passwordProblems("abcdefg1!").includes("an uppercase letter"));
  assert.ok(passwordProblems("Abcdefgh!").includes("a number"));
  assert.ok(passwordProblems("Abcdefg1").includes("a symbol"));
  assert.ok(passwordProblems("Ab1!").includes("at least 8 characters"));
  assert.ok(passwordProblems("Ab1!" + "x".repeat(50)).includes("at most 50 characters"));
});

function fakeVercel(states) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body && JSON.parse(opts.body) });
    const u = new URL(url);
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    assert.equal(u.searchParams.get("slug"), "acrfs-projects");
    if (opts.method === "GET" && u.pathname === "/v10/projects/shana-studios/env")
      return json({ envs: [{ id: "e1", key: "SMTP_PASS" }, { id: "e2", key: "SMTP_PASS" }, { id: "e3", key: "OTHER" }] });
    if (opts.method === "PATCH") return json({});
    if (u.pathname === "/v9/projects/shana-studios") return json({ id: "prj_1", name: "shana-studios" });
    if (u.pathname === "/v6/deployments") return json({ deployments: [{ uid: "dpl_old" }] });
    if (opts.method === "POST") return json({ id: "dpl_new", readyState: "QUEUED" });
    if (u.pathname === "/v13/deployments/dpl_new") return json({ readyState: states.shift() });
    throw new Error("unexpected " + url);
  };
  return { calls, fetchImpl };
}

test("vercel: updates every SMTP_PASS, redeploys production and waits", async () => {
  const { calls, fetchImpl } = fakeVercel(["BUILDING", "READY"]);
  const r = await syncVercel(cfg, "Abcdef1!", { fetchImpl, sleep: async () => {} });
  assert.equal(r.ok, true, r.detail);
  const patches = calls.filter((c) => c.method === "PATCH");
  assert.deepEqual(patches.map((c) => new URL(c.url).pathname), ["/v9/projects/shana-studios/env/e1", "/v9/projects/shana-studios/env/e2"]);
  assert.deepEqual(patches[0].body, { value: "Abcdef1!" });
  const post = calls.find((c) => c.method === "POST");
  assert.deepEqual(post.body, { name: "shana-studios", deploymentId: "dpl_old", target: "production" });
});

test("vercel: reports a failed redeploy", async () => {
  const { fetchImpl } = fakeVercel(["ERROR"]);
  const r = await syncVercel(cfg, "Abcdef1!", { fetchImpl, sleep: async () => {} });
  assert.equal(r.ok, false);
  assert.match(r.detail, /ERROR/);
});

test("vercel: API errors become a readable message", async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => JSON.stringify({ error: { message: "Not authorized" } }) });
  const r = await syncVercel(cfg, "Abcdef1!", { fetchImpl });
  assert.deepEqual(r, { ok: false, detail: "Vercel: Not authorized" });
});

test("portal: sends the token and both addresses", async () => {
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return { ok: true, json: async () => ({ login: "updated", smtpWorkspaces: 1 }) }; };
  const r = await syncPortal(cfg, "Abcdef1!", fetchImpl);
  assert.equal(r.ok, true);
  assert.equal(seen.url, "http://atrium:8080/api/internal/studio-sync/password");
  assert.equal(seen.opts.headers["x-studio-sync-token"], cfg.portalSyncToken);
  assert.deepEqual(JSON.parse(seen.opts.body), { loginEmail: cfg.portalLoginEmail, smtpUser: cfg.mailbox, password: "Abcdef1!" });
});

test("views escape text and never include the password", () => {
  const html = emailHtml([{ ok: true, label: "<b>x</b>", detail: "fine" }]);
  assert.ok(!html.includes("<b>x</b>"));
  assert.match(pageHtml(cfg), /Titan webmail/);
});

import { createSessions, readCookie, sessionCookie, SESSION_TTL_MS } from "./session.mjs";

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

test("sign-in page asks for the current password", async () => {
  const { signInHtml } = await import("./views.mjs");
  assert.match(signInHtml(cfg), /current-password/);
});
