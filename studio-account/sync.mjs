// The password sync steps. Each step takes the new password and returns
// { ok, detail } so the page can show one line per place.
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";

/** Titan's own rule (Hostinger documents the same one): 8 to 50 characters,
 * upper and lower case letters, a number and a symbol. */
export function passwordProblems(password) {
  const problems = [];
  if (typeof password !== "string" || password.length < 8) problems.push("at least 8 characters");
  if (typeof password === "string" && password.length > 50) problems.push("at most 50 characters");
  if (!/[A-Z]/.test(password ?? "")) problems.push("an uppercase letter");
  if (!/[a-z]/.test(password ?? "")) problems.push("a lowercase letter");
  if (!/[0-9]/.test(password ?? "")) problems.push("a number");
  if (!/[^A-Za-z0-9]/.test(password ?? "")) problems.push("a symbol");
  return problems;
}

/** Signs in to Titan's mail server with the password. This is the proof that
 * the person changed the mailbox password themselves, so it gates every other step. */
export async function verifyTitan(cfg, password) {
  const client = new ImapFlow({
    host: cfg.imapHost,
    port: 993,
    secure: true,
    auth: { user: cfg.mailbox, pass: password },
    logger: false,
    socketTimeout: 20_000,
  });
  try {
    await client.connect();
    await client.logout();
    return { ok: true, detail: "Titan accepted the new password" };
  } catch (err) {
    const authFailed = err?.authenticationFailed || /auth/i.test(String(err?.responseText ?? err?.message ?? ""));
    return {
      ok: false,
      authFailed: Boolean(authFailed),
      detail: authFailed
        ? "Titan did not accept this password. Change it in Titan webmail first, then try again."
        : "Could not reach Titan's mail server. Nothing was changed; try again in a minute.",
    };
  } finally {
    client.close();
  }
}

/** Portal: sign-in password and the email (SMTP) setting, through the
 * portal's internal endpoint on the Docker network. */
export async function syncPortal(cfg, password, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`${cfg.portalInternalUrl}/api/internal/studio-sync/password`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-studio-sync-token": cfg.portalSyncToken },
      body: JSON.stringify({ loginEmail: cfg.portalLoginEmail, smtpUser: cfg.mailbox, password }),
    });
    if (!res.ok) return { ok: false, detail: `Portal refused the change (HTTP ${res.status})` };
    const body = await res.json();
    const smtp = body.smtpWorkspaces > 0 ? "and its email setting" : "(no portal email setting uses this mailbox)";
    return { ok: true, detail: `Portal sign-in updated ${smtp}` };
  } catch {
    return { ok: false, detail: "Could not reach the portal" };
  }
}

function vercelUrl(cfg, path) {
  const sep = path.includes("?") ? "&" : "?";
  return `https://api.vercel.com${path}${cfg.vercelTeam ? `${sep}slug=${encodeURIComponent(cfg.vercelTeam)}` : ""}`;
}

async function vercel(cfg, fetchImpl, method, path, body) {
  const res = await fetchImpl(vercelUrl(cfg, path), {
    method,
    headers: { authorization: `Bearer ${cfg.vercelToken}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`Vercel: ${msg}`);
  }
  return json;
}

/** Website: updates SMTP_PASS on the Vercel project, then redeploys
 * production so the lead form uses it. Waits for the deploy to finish. */
export async function syncVercel(cfg, password, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxWaitMs = 300_000 } = {}) {
  try {
    const project = encodeURIComponent(cfg.vercelProject);
    const list = await vercel(cfg, fetchImpl, "GET", `/v10/projects/${project}/env`);
    const vars = (list?.envs ?? []).filter((e) => e.key === cfg.vercelEnvKey);
    if (vars.length === 0) return { ok: false, detail: `${cfg.vercelEnvKey} is not set on the Vercel project` };
    for (const v of vars) {
      await vercel(cfg, fetchImpl, "PATCH", `/v9/projects/${project}/env/${v.id}`, { value: password });
    }

    const proj = await vercel(cfg, fetchImpl, "GET", `/v9/projects/${project}`);
    const deps = await vercel(cfg, fetchImpl, "GET", `/v6/deployments?projectId=${proj.id}&target=production&state=READY&limit=1`);
    const last = deps?.deployments?.[0];
    if (!last) return { ok: false, detail: "Password saved on Vercel, but no production deploy to refresh. Redeploy from the Vercel dashboard." };
    const fresh = await vercel(cfg, fetchImpl, "POST", `/v13/deployments`, {
      name: proj.name,
      deploymentId: last.uid,
      target: "production",
    });

    const started = Date.now();
    let state = fresh.readyState;
    while (state !== "READY" && Date.now() - started < maxWaitMs) {
      if (state === "ERROR" || state === "CANCELED") {
        return { ok: false, detail: `Password saved on Vercel, but the redeploy ended in ${state}. Redeploy from the Vercel dashboard.` };
      }
      await sleep(5_000);
      state = (await vercel(cfg, fetchImpl, "GET", `/v13/deployments/${fresh.id}`)).readyState;
    }
    if (state !== "READY") return { ok: false, detail: "Password saved on Vercel; the redeploy is still running. Check the Vercel dashboard in a few minutes." };
    return { ok: true, detail: `Website lead form updated (${vars.length === 1 ? "1 setting" : `${vars.length} settings`}, redeployed)` };
  } catch (err) {
    return { ok: false, detail: String(err?.message ?? err) };
  }
}

/** A short branded note to the mailbox, sent with the new password (which
 * proves sending works). The password itself is never in the email. */
export async function sendConfirmation(cfg, password, results, renderEmail) {
  try {
    const transport = nodemailer.createTransport({
      host: cfg.smtpHost,
      port: 465,
      secure: true,
      auth: { user: cfg.mailbox, pass: password },
    });
    await transport.sendMail({
      from: `"Shana Studios" <${cfg.mailbox}>`,
      to: cfg.mailbox,
      subject: "Your password was updated everywhere",
      html: renderEmail(results),
      text: results.map((r) => `${r.ok ? "Done" : "Needs attention"}: ${r.label}. ${r.detail}`).join("\n"),
    });
    transport.close();
    return { ok: true, detail: "Confirmation email sent" };
  } catch {
    return { ok: false, detail: "The confirmation email could not be sent" };
  }
}
