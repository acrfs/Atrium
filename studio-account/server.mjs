// account.shanastudios.co: Shana signs in with her current password and sets a
// new one. It's her portal password, which is also her Google Workspace sign-in.
import http from "node:http";
import { readFileSync } from "node:fs";
import { passwordProblems, usernameMatches, verifyPortal, setPortalPassword } from "./sync.mjs";
import { pageHtml, signInHtml } from "./views.mjs";
import { createSessions, readCookie, sessionCookie, SESSION_COOKIE, SESSION_TTL_MS } from "./session.mjs";

const env = process.env;
const cfg = {
  portalInternalUrl: env.PORTAL_INTERNAL_URL ?? "http://atrium:8080",
  portalSyncToken: env.STUDIO_SYNC_TOKEN ?? "",
  portalLoginEmail: env.PORTAL_LOGIN_EMAIL ?? env.MAILBOX ?? "shana@shanastudios.co",
};
const PORT = Number(env.PORT ?? 8090);
const LOGO = readFileSync(new URL("./logo.png", import.meta.url));

// At most 5 tries per 15 minutes from one address, 20 overall, so the page
// can't be used to guess the password.
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map();
let globalAttempts = [];
function allowAttempt(ip) {
  const now = Date.now();
  globalAttempts = globalAttempts.filter((t) => now - t < WINDOW_MS);
  const mine = (attempts.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  if (mine.length >= 5 || globalAttempts.length >= 20) return false;
  mine.push(now);
  globalAttempts.push(now);
  attempts.set(ip, mine);
  return true;
}

let busy = false;
const sessions = createSessions();
const signedIn = (req) => sessions.valid(readCookie(req.headers.cookie, SESSION_COOKIE));
const clientIp = (req) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > limit) { reject(new Error("too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    ...extra,
    "content-type": type,
    "cache-control": "no-store",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' https://shanastudios.co; script-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/") {
      return send(res, 200, "text/html; charset=utf-8", signedIn(req) ? pageHtml() : signInHtml());
    }
    if (req.method === "GET" && url.pathname === "/logo.png") {
      res.writeHead(200, { "content-type": "image/png", "cache-control": "public, max-age=86400" });
      return res.end(LOGO);
    }
    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, "text/plain", "ok");
    }
    if (req.method === "POST" && url.pathname === "/login") {
      if (req.headers["content-type"] !== "application/json") return send(res, 415, "application/json", '{"error":"JSON only"}');
      if (!allowAttempt(clientIp(req))) {
        return send(res, 429, "application/json", JSON.stringify({ error: "Too many tries. Wait 15 minutes and try again." }));
      }
      const { username, password } = JSON.parse(await readBody(req));
      if (typeof username !== "string" || !username.trim() || typeof password !== "string" || !password) {
        return send(res, 400, "application/json", '{"error":"Enter your username and password."}');
      }
      // Same answer for a wrong username or a wrong password, so the page
      // doesn't tell anyone which username is real.
      const wrong = () => send(res, 401, "application/json", '{"error":"That username and password don\'t match."}');
      if (!usernameMatches(username, cfg.portalLoginEmail)) return wrong();
      const check = await verifyPortal(cfg, password);
      if (!check.ok) return check.authFailed ? wrong() : send(res, 502, "application/json", JSON.stringify({ error: check.detail }));
      console.log(new Date().toISOString(), "signed in");
      return send(res, 200, "application/json", '{"ok":true}', { "set-cookie": sessionCookie(sessions.issue(), SESSION_TTL_MS / 1000) });
    }
    if (req.method === "POST" && url.pathname === "/logout") {
      return send(res, 200, "application/json", '{"ok":true}', { "set-cookie": sessionCookie("", 0) });
    }
    if (req.method === "POST" && url.pathname === "/sync") {
      if (!signedIn(req)) return send(res, 401, "application/json", JSON.stringify({ error: "Your sign-in expired. Refresh the page and sign in again." }));
      if (req.headers["content-type"] !== "application/json") return send(res, 415, "application/json", '{"error":"JSON only"}');
      if (!allowAttempt(clientIp(req))) {
        return send(res, 429, "application/json", JSON.stringify({ error: "Too many tries. Wait 15 minutes and try again." }));
      }
      if (busy) return send(res, 409, "application/json", JSON.stringify({ error: "A change is already running. Wait a minute and try again." }));
      const { password, current } = JSON.parse(await readBody(req));
      const problems = passwordProblems(password);
      if (problems.length) {
        return send(res, 400, "application/json", JSON.stringify({ error: `The password needs ${problems.join(", ")}.` }));
      }
      busy = true;
      try {
        // The current password again, so an unattended signed-in page can't be used to take over the account.
        const check = await verifyPortal(cfg, typeof current === "string" ? current : "");
        if (!check.ok) {
          return check.authFailed
            ? send(res, 401, "application/json", JSON.stringify({ error: "Your current password isn't right." }))
            : send(res, 502, "application/json", JSON.stringify({ error: check.detail }));
        }
        const results = await setPortalPassword(cfg, password);
        console.log(new Date().toISOString(), "sync", results.map((r) => `${r.label}=${r.ok ? "ok" : "fail"}`).join(" "));
        return send(res, 200, "application/json", JSON.stringify({ results }));
      } finally {
        busy = false;
      }
    }
    send(res, 404, "text/plain", "Not found");
  } catch (err) {
    console.error(new Date().toISOString(), "error", err?.message);
    if (!res.headersSent) send(res, 500, "application/json", '{"error":"Something went wrong. Nothing was shown to anyone; try again."}');
  }
});

server.requestTimeout = 400_000;
server.listen(PORT, () => console.log(`studio-account listening on ${PORT}`));
