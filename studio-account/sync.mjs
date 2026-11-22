// The account page's two calls to the portal. Shana's portal password is also
// her Google Workspace sign-in (the portal is Google's identity provider), so
// setting it here changes both.

/** The portal's own rule (Better Auth): 8 to 128 characters. */
export function passwordProblems(password) {
  const problems = [];
  if (typeof password !== "string" || password.length < 8) problems.push("at least 8 characters");
  if (typeof password === "string" && password.length > 128) problems.push("at most 128 characters");
  return problems;
}

/** The username is her address: either the full address or the part before
 * the @, any letter case. */
export function usernameMatches(username, address) {
  if (typeof username !== "string") return false;
  const u = username.trim().toLowerCase();
  const m = String(address).toLowerCase();
  return u.length > 0 && (u === m || u === m.split("@")[0]);
}

async function portal(cfg, path, body, fetchImpl) {
  return fetchImpl(`${cfg.portalInternalUrl}/api/internal/studio-sync/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-studio-sync-token": cfg.portalSyncToken },
    body: JSON.stringify(body),
  });
}

/** Checks the current password with the portal. Gates the page's sign-in. */
export async function verifyPortal(cfg, password, fetchImpl = fetch) {
  try {
    const res = await portal(cfg, "verify", { loginEmail: cfg.portalLoginEmail, password }, fetchImpl);
    if (!res.ok) return { ok: false, authFailed: false, detail: `The portal could not check the password (HTTP ${res.status}). Try again in a minute.` };
    const body = await res.json();
    return body.ok ? { ok: true } : { ok: false, authFailed: true };
  } catch {
    return { ok: false, authFailed: false, detail: "Could not reach the portal. Try again in a minute." };
  }
}

/** Sets the new password on the portal, which also emails her a notice. */
export async function setPortalPassword(cfg, password, fetchImpl = fetch) {
  try {
    const res = await portal(cfg, "password", { loginEmail: cfg.portalLoginEmail, password }, fetchImpl);
    if (!res.ok) return [{ ok: false, label: "Portal and Google sign-in", detail: `The portal refused the change (HTTP ${res.status}). Nothing was changed.` }];
    const body = await res.json();
    return [
      { ok: true, label: "Portal and Google sign-in", detail: "Your new password works for the client portal and for Gmail, Drive and Calendar" },
      body.notified
        ? { ok: true, label: "Confirmation email", detail: "A notice was sent to your inbox" }
        : { ok: false, label: "Confirmation email", detail: "The notice email could not be sent, but the password did change" },
    ];
  } catch {
    return [{ ok: false, label: "Portal and Google sign-in", detail: "Could not reach the portal. Nothing was changed." }];
  }
}
