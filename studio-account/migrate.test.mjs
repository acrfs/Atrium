import { test } from "node:test";
import assert from "node:assert/strict";
import { authUrl, checkLinked, createStates, googleClient, migrateConfig, SCOPES } from "./google.mjs";
import { copyCalendars, copyMail, eventForImport, exdateFor, labelsForCopy, messageIdOf, newProgress, runMigration } from "./migrate.mjs";

const cfg = migrateConfig({ GOOGLE_MIGRATE_CLIENT_ID: "id", GOOGLE_MIGRATE_CLIENT_SECRET: "secret", PORTAL_LOGIN_EMAIL: "Shana@ShanaStudios.co" });
const b64url = (s) => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

test("config: off without a client, target is the portal login", () => {
  assert.equal(migrateConfig({}).enabled, false);
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.targetEmail, "shana@shanastudios.co");
  assert.equal(cfg.redirectUri, "https://account.shanastudios.co/google/callback");
});

test("sign-in link asks for offline access, the role's scopes and the state", () => {
  const u = new URL(authUrl(cfg, "source", "abc", "old@gmail.com"));
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("state"), "abc");
  assert.equal(u.searchParams.get("login_hint"), "old@gmail.com");
  assert.equal(u.searchParams.get("scope"), SCOPES.source.join(" "));
  assert.ok(!u.searchParams.get("scope").includes("gmail.insert"), "old account is read only");
});

test("states are single use, keep their role and expire", () => {
  let t = 0;
  const s = createStates(() => t, 1000);
  const a = s.issue("target");
  assert.equal(s.take(a), "target");
  assert.equal(s.take(a), undefined);
  const b = s.issue("source");
  t = 2000;
  assert.equal(s.take(b), undefined);
  assert.equal(s.take("made-up"), undefined);
});

test("checkLinked: right accounts and every permission", () => {
  const all = (role) => SCOPES[role];
  assert.equal(checkLinked(cfg, "target", { email: "shana@shanastudios.co", scopes: all("target") }), "");
  assert.match(checkLinked(cfg, "target", { email: "someone@gmail.com", scopes: all("target") }), /shana@shanastudios.co/);
  assert.match(checkLinked(cfg, "source", { email: "shana@shanastudios.co", scopes: all("source") }), /new account/);
  assert.equal(checkLinked(cfg, "source", { email: "shanatstudios@gmail.com", scopes: all("source") }), "");
  assert.match(checkLinked(cfg, "source", { email: "shanatstudios@gmail.com", scopes: ["openid"] }), /permission/);
  const strict = { ...cfg, sourceEmail: "shanatstudios@gmail.com" };
  assert.match(checkLinked(strict, "source", { email: "other@gmail.com", scopes: all("source") }), /shanatstudios@gmail.com/);
});

test("messageIdOf reads folded and plain headers, not the body", () => {
  assert.equal(messageIdOf("From: a\r\nMessage-ID: <abc@mail.gmail.com>\r\n\r\nbody"), "abc@mail.gmail.com");
  assert.equal(messageIdOf("Message-Id:\r\n <x.y@z>\r\n\r\n"), "x.y@z");
  assert.equal(messageIdOf("From: a\n\nMessage-ID: <in-body@x>"), null);
});

test("labelsForCopy keeps useful system labels and names user labels", () => {
  const src = new Map([["Label_1", { type: "user", name: "Clients/Acme" }], ["SPAM", { type: "system", name: "SPAM" }]]);
  assert.deepEqual(labelsForCopy(["INBOX", "UNREAD", "Label_1", "SPAM", "CATEGORY_PROMOTIONS"], src), {
    system: ["INBOX", "UNREAD", "CATEGORY_PROMOTIONS"],
    user: ["Clients/Acme"],
  });
});

test("exdateFor: all-day and timed occurrences", () => {
  assert.equal(exdateFor({ date: "2026-12-25" }), "EXDATE;VALUE=DATE:20261225");
  assert.equal(exdateFor({ dateTime: "2026-12-01T10:00:00-05:00" }), "EXDATE:20261201T150000Z");
  assert.equal(exdateFor({}), null);
});

test("eventForImport drops ids and server fields, adds exdates", () => {
  const ev = {
    id: "e1", etag: "x", htmlLink: "h", iCalUID: "u1", summary: "Call", start: { date: "2026-01-01" }, end: { date: "2026-01-02" },
    recurrence: ["RRULE:FREQ=WEEKLY"], attendees: [{ email: "a@x", self: true, id: "1", responseStatus: "accepted" }],
    organizer: { email: "o@x", self: true }, conferenceData: { entryPoints: [{ uri: "u" }], createRequest: {} },
  };
  const out = eventForImport(ev, ["EXDATE;VALUE=DATE:20260108"]);
  assert.equal(out.id, undefined);
  assert.equal(out.etag, undefined);
  assert.equal(out.htmlLink, undefined);
  assert.deepEqual(out.attendees, [{ email: "a@x", responseStatus: "accepted" }]);
  assert.deepEqual(out.organizer, { email: "o@x" });
  assert.equal(out.conferenceData.createRequest, undefined);
  assert.deepEqual(out.recurrence, ["RRULE:FREQ=WEEKLY", "EXDATE;VALUE=DATE:20260108"]);
  assert.deepEqual(ev.recurrence, ["RRULE:FREQ=WEEKLY"], "the original is not changed");
});

/** A tiny stand-in for a Google account: route -> handler. */
function fakeClient(routes) {
  const calls = [];
  return {
    calls,
    async call(method, url, opts = {}) {
      calls.push({ method, url, opts });
      for (const [match, fn] of routes) {
        const [m, re] = match;
        if (m === method && re.test(url)) return fn(url, opts);
      }
      throw new Error(`no route ${method} ${url}`);
    },
  };
}

test("copyMail copies, skips drafts and messages already there, and makes labels", async () => {
  const raws = {
    m1: "Message-ID: <one@x>\r\nSubject: hi\r\n\r\nbody",
    m2: "Message-ID: <two@x>\r\n\r\nalready copied",
    m3: "Subject: draft\r\n\r\n",
    m4: "Subject: no id\r\n\r\nbody",
  };
  const labels = { m1: ["INBOX", "Label_9"], m2: ["INBOX"], m3: ["DRAFT"], m4: ["SENT"] };
  const src = fakeClient([
    [["GET", /\/profile$/], () => ({ messagesTotal: 4 })],
    [["GET", /\/labels$/], () => ({ labels: [{ id: "Label_9", type: "user", name: "Clients/Acme" }] })],
    [["GET", /\/messages\?/], () => ({ messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }, { id: "m4" }] })],
    [["GET", /\/messages\/m\d/], (url) => {
      const id = url.match(/messages\/(m\d)/)[1];
      return { raw: b64url(raws[id]), labelIds: labels[id] };
    }],
  ]);
  const made = [];
  const dst = fakeClient([
    [["GET", /\/labels$/], () => ({ labels: [{ id: "INBOX", name: "INBOX" }, { id: "L_clients", name: "Clients" }] })],
    [["POST", /\/labels$/], (_u, o) => { made.push(o.json.name); return { id: `L_${made.length}` }; }],
    [["GET", /\/messages\?q=rfc822msgid/], (url) => ({ messages: url.includes("two%40x") ? [{ id: "d2" }] : [] })],
    [["POST", /\/upload\/gmail\/v1\/users\/me\/messages\/import/], () => ({ id: "new" })],
  ]);
  const p = newProgress();
  await copyMail(src, dst, p);
  assert.deepEqual(p.mail, { total: 4, copied: 2, already: 1, skipped: 1, failed: 0 });
  assert.deepEqual(made, ["Clients/Acme"], "parent label reused, child made once");
  const imports = dst.calls.filter((c) => c.url.includes("/import"));
  assert.equal(imports.length, 2);
  const first = imports.find((c) => c.opts.body.toString().includes("<one@x>")).opts;
  assert.match(first.headers["content-type"], /^multipart\/related; boundary=/);
  const text = first.body.toString();
  assert.ok(text.includes('{"labelIds":["INBOX","L_1"]}'));
  assert.ok(text.includes("Message-ID: <one@x>"));
  assert.ok(imports[0].url.includes("neverMarkSpam=true"));
});

test("copyMail counts a failed message and keeps going", async () => {
  const src = fakeClient([
    [["GET", /\/profile$/], () => ({ messagesTotal: 2 })],
    [["GET", /\/labels$/], () => ({ labels: [] })],
    [["GET", /\/messages\?/], () => ({ messages: [{ id: "bad" }, { id: "ok" }] })],
    [["GET", /\/messages\/bad/], () => { throw new Error("gone"); }],
    [["GET", /\/messages\/ok/], () => ({ raw: b64url("Subject: x\r\n\r\n"), labelIds: ["INBOX"] })],
  ]);
  const dst = fakeClient([
    [["GET", /\/labels$/], () => ({ labels: [] })],
    [["POST", /\/messages\/import/], () => ({ id: "n" })],
  ]);
  const p = newProgress();
  await copyMail(src, dst, p);
  assert.equal(p.mail.copied, 1);
  assert.equal(p.mail.failed, 1);
  assert.match(p.errors[0], /gone/);
});

test("copyCalendars copies her own calendars only and folds cancelled occurrences", async () => {
  const src = fakeClient([
    [["GET", /calendarList/], () => ({ items: [
      { id: "old@gmail.com", primary: true, accessRole: "owner", summary: "old@gmail.com" },
      { id: "c2", accessRole: "owner", summary: "Studio", timeZone: "America/New_York" },
      { id: "holidays", accessRole: "reader", summary: "Holidays" },
    ] })],
    [["GET", /calendars\/old%40gmail\.com\/events/], () => ({ items: [
      { id: "s1", iCalUID: "u1", summary: "Weekly", start: { dateTime: "2026-01-05T10:00:00Z" }, end: { dateTime: "2026-01-05T11:00:00Z" }, recurrence: ["RRULE:FREQ=WEEKLY"] },
      { id: "s1_x", recurringEventId: "s1", status: "cancelled", originalStartTime: { dateTime: "2026-01-12T10:00:00Z" } },
      { id: "s1_y", recurringEventId: "s1", iCalUID: "u1", summary: "Weekly (moved)", originalStartTime: { dateTime: "2026-01-19T10:00:00Z" }, start: { dateTime: "2026-01-19T12:00:00Z" }, end: { dateTime: "2026-01-19T13:00:00Z" } },
      { id: "b1", iCalUID: "ub", eventType: "birthday", start: { date: "2026-03-01" }, end: { date: "2026-03-02" } },
      { id: "gone", iCalUID: "ug", status: "cancelled" },
    ] })],
    [["GET", /calendars\/c2\/events/], () => ({ items: [{ id: "e2", iCalUID: "u2", summary: "Shoot", start: { date: "2026-02-01" }, end: { date: "2026-02-02" } }] })],
  ]);
  const dst = fakeClient([
    [["GET", /calendarList/], () => ({ items: [{ id: "shana@shanastudios.co", primary: true, accessRole: "owner" }] })],
    [["POST", /\/calendars$/], (_u, o) => ({ id: "newcal", summary: o.json.summary })],
    [["POST", /\/events\/import/], () => ({ id: "x" })],
  ]);
  const p = newProgress();
  await copyCalendars(src, dst, p);
  assert.deepEqual(p.calendar, { calendars: 2, others: 1, copied: 3, skipped: 1, failed: 0 });
  const imports = dst.calls.filter((c) => c.url.includes("/events/import"));
  assert.ok(imports[0].url.includes("/calendars/primary/"));
  assert.deepEqual(imports[0].opts.json.recurrence, ["RRULE:FREQ=WEEKLY", "EXDATE:20260112T100000Z"]);
  assert.equal(imports[1].opts.json.summary, "Weekly (moved)", "series first, then changed occurrences");
  assert.ok(imports[2].url.includes("/calendars/newcal/"));
  assert.equal(dst.calls.filter((c) => c.method === "POST" && /\/calendars$/.test(c.url)).length, 1);
});

test("runMigration reports a failure instead of throwing", async () => {
  const broken = { call: async () => { throw new Error("Google said no"); } };
  const p = newProgress();
  await runMigration(broken, broken, p, { mail: true, calendar: false });
  assert.equal(p.state, "failed");
  assert.equal(p.message, "Google said no");
  assert.ok(p.finishedAt);
});

test("googleClient refreshes an expired token and retries busy answers", async () => {
  const seen = [];
  let n = 0;
  const fetchImpl = async (url, opts) => {
    seen.push(url);
    if (url.includes("oauth2.googleapis.com/token")) return { ok: true, status: 200, json: async () => ({ access_token: "fresh", expires_in: 3600 }) };
    n++;
    if (n === 1) return { ok: false, status: 429, text: async () => "" };
    assert.equal(opts.headers.authorization, "Bearer fresh");
    return { ok: true, status: 200, json: async () => ({ fine: true }) };
  };
  const c = googleClient(cfg, { accessToken: "old", expiresAt: 0, refreshToken: "r" }, fetchImpl, async () => {});
  assert.deepEqual(await c.call("GET", "https://gmail.googleapis.com/x"), { fine: true });
  assert.equal(seen.filter((u) => u.includes("/token")).length, 1);
});
