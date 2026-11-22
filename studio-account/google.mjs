// Google sign-in and API calls for the move from Shana's old Gmail account.
// No libraries: plain fetch against Google's REST endpoints.
import { randomBytes } from "node:crypto";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

// Old account: read only. New account: add mail and calendars, and read mail
// so a message that is already there isn't copied twice.
export const SCOPES = {
  source: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/calendar.readonly",
  ],
  target: [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.insert",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/calendar",
  ],
};

export function migrateConfig(env) {
  const clientId = env.GOOGLE_MIGRATE_CLIENT_ID ?? "";
  const clientSecret = env.GOOGLE_MIGRATE_CLIENT_SECRET ?? "";
  const publicUrl = (env.ACCOUNT_PUBLIC_URL ?? "https://account.shanastudios.co").replace(/\/+$/, "");
  return {
    enabled: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri: `${publicUrl}/google/callback`,
    targetEmail: (env.MIGRATE_TARGET_EMAIL ?? env.PORTAL_LOGIN_EMAIL ?? "shana@shanastudios.co").toLowerCase(),
    // Optional: only this old address may be used as the source.
    sourceEmail: (env.MIGRATE_SOURCE_EMAIL ?? "").toLowerCase(),
  };
}

/** One-use sign-in states, so a Google answer is only accepted for a sign-in
 * this page started (and the role it was started for). */
export function createStates(now = () => Date.now(), ttlMs = 10 * 60 * 1000) {
  const pending = new Map();
  return {
    issue(role) {
      const s = randomBytes(24).toString("hex");
      pending.set(s, { role, exp: now() + ttlMs });
      return s;
    },
    take(s) {
      const hit = pending.get(s);
      pending.delete(s);
      for (const [k, v] of pending) if (v.exp < now()) pending.delete(k);
      return hit && hit.exp >= now() ? hit.role : undefined;
    },
  };
}

export function authUrl(cfg, role, state, loginHint) {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: SCOPES[role].join(" "),
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "false",
    state,
  });
  if (loginHint) q.set("login_hint", loginHint);
  return `${AUTH_URL}?${q}`;
}

/** Trades the code for tokens and reads which account signed in. */
export async function exchangeCode(cfg, code, fetchImpl = fetch) {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google sign-in failed (HTTP ${res.status})`);
  const t = await res.json();
  const info = await fetchImpl(USERINFO_URL, { headers: { authorization: `Bearer ${t.access_token}` } });
  if (!info.ok) throw new Error(`Could not read the Google account (HTTP ${info.status})`);
  const { email } = await info.json();
  return {
    email: String(email ?? "").toLowerCase(),
    scopes: String(t.scope ?? "").split(" "),
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (Number(t.expires_in ?? 3600) - 60) * 1000,
  };
}

export async function revoke(account, fetchImpl = fetch) {
  const token = account?.refreshToken ?? account?.accessToken;
  if (!token) return;
  try {
    await fetchImpl(REVOKE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
  } catch {
    // Best effort: tokens from a Testing app also expire on their own in 7 days.
  }
}

/** Checks the Google account that just signed in for a role. */
export function checkLinked(cfg, role, acct) {
  const missing = SCOPES[role].filter((s) => s.startsWith("https://") && !acct.scopes.includes(s));
  if (missing.length) return "Google didn't give every permission the copy needs. Connect again and leave every box ticked.";
  if (role === "target" && acct.email !== cfg.targetEmail) return `That was ${acct.email}. Connect your Shana Studios account, ${cfg.targetEmail}.`;
  if (role === "source" && acct.email === cfg.targetEmail) return "That's your new account. Connect your old Gmail account here.";
  if (role === "source" && cfg.sourceEmail && acct.email !== cfg.sourceEmail) return `That was ${acct.email}. Connect your old account, ${cfg.sourceEmail}.`;
  return "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GoogleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** A signed-in account that refreshes its token and retries busy answers. */
export function googleClient(cfg, account, fetchImpl = fetch, wait = sleep) {
  async function token() {
    if (account.accessToken && Date.now() < account.expiresAt) return account.accessToken;
    if (!account.refreshToken) throw new GoogleError(401, "Google sign-in expired. Connect the account again.");
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: account.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) throw new GoogleError(401, "Google sign-in expired. Connect the account again.");
    const t = await res.json();
    account.accessToken = t.access_token;
    account.expiresAt = Date.now() + (Number(t.expires_in ?? 3600) - 60) * 1000;
    return account.accessToken;
  }

  async function call(method, url, { json, body, headers = {}, raw = false } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${await token()}`,
          ...(json !== undefined ? { "content-type": "application/json" } : {}),
          ...headers,
        },
        body: json !== undefined ? JSON.stringify(json) : body,
      });
      if (res.status === 401 && attempt === 0) {
        account.expiresAt = 0;
        continue;
      }
      const busy = res.status === 429 || res.status >= 500 || (res.status === 403 && /rate|quota/i.test(await peek(res)));
      if (busy && attempt < 5) {
        await wait(Math.min(32_000, 1000 * 2 ** attempt));
        continue;
      }
      if (!res.ok) throw new GoogleError(res.status, await errorText(res));
      if (raw) return res;
      return res.status === 204 ? {} : res.json();
    }
  }

  return { call, account };
}

// Reading the body of an error twice is fine because we keep the text.
async function peek(res) {
  if (res._text === undefined) res._text = await res.text().catch(() => "");
  return res._text;
}
async function errorText(res) {
  const text = await peek(res);
  try {
    const j = JSON.parse(text);
    return j.error?.message ?? j.error_description ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}
