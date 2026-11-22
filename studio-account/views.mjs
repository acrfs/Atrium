// The account page, in the Shana Studios look
// (same palette and fonts as shanastudios.co and the portal).
const S = {
  indigo: "#2d2c80",
  peri: "#5f7bbc",
  pink: "#efbdd7",
  coral: "#f48863",
  cream: "#fdf8c3",
  paper: "#fffdf2",
  line: "#ebe5c3",
  alert: "#c4492c",
  logo: "https://shanastudios.co/email/s-logo.png",
  serif: "'Instrument Serif', Georgia, serif",
  sans: "'Outfit', 'Helvetica Neue', Arial, sans-serif",
  cta: "'Fraunces', Georgia, serif",
};

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const head = (title) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@400;500&family=Fraunces:opsz,wght,SOFT@9..144,620,100&display=swap">
<style>
  :root { --ink:${S.indigo}; --peri:${S.peri}; --paper:${S.paper}; --line:${S.line}; --alert:${S.alert}; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.55 ${S.sans}; }
  main { max-width: 34rem; margin: 0 auto; padding: 48px 16px 64px; }
  .mark { width: 56px; height: 56px; display:block; margin-bottom: 24px; }
  h1 { font: 400 clamp(2.4rem, 7vw, 3.2rem)/1.05 ${S.serif}; margin: 0 0 12px; }
  p.lead { color: var(--peri); margin: 0 0 32px; }
  a { color: var(--ink); }
  label { display:block; font-weight:500; margin: 16px 0 6px; }
  input[type=password], input[type=text] { width:100%; padding: 12px 14px; font: inherit; color: var(--ink);
    background: #fff; border: 1.5px solid var(--line); border-radius: 12px; }
  input:focus { outline: 2px solid var(--peri); outline-offset: 1px; }
  .show { display:flex; gap:8px; align-items:center; margin-top: 10px; font-size: .9rem; color: var(--peri); }
  .rules { font-size: .9rem; color: var(--peri); margin-top: 8px; }
  button { margin-top: 24px; appearance:none; border:0; border-radius: 999px; padding: 14px 28px; cursor:pointer;
    background: var(--ink); color: var(--paper); font: 620 1.05rem/1 ${S.cta}; font-variation-settings: "SOFT" 100; }
  button.alt { background: transparent; color: var(--ink); border: 1.5px solid var(--ink); padding: 10px 20px; margin-top: 8px; font-size: .95rem; }
  button[disabled] { opacity: .55; cursor: progress; }
  .msg { margin-top: 20px; padding: 14px 16px; border-radius: 12px; background: #fff; border: 1.5px solid var(--line); }
  .msg.err { border-color: var(--alert); color: var(--alert); }
  ul.results { list-style:none; padding:0; margin: 24px 0 0; }
  ul.results li { display:flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line); }
  ul.results .i { flex: 0 0 24px; height: 24px; border-radius: 50%; text-align:center; line-height: 24px; font-weight:500; }
  ul.results .ok .i { background: ${S.cream}; }
  ul.results .bad .i { background: ${S.coral}; color: var(--paper); }
  ul.results b { display:block; font-weight:500; }
  ul.results small { color: var(--peri); font-size: .9rem; }
  footer { margin-top: 48px; font-size: .85rem; color: var(--peri); }
</style>
</head>
<body>
`;

export function pageHtml({ migrate = false } = {}) {
  return `${head("Account settings · Shana Studios")}<main>
  <img class="mark" src="/logo.png" alt="Shana Studios">
  <h1>Account settings</h1>
  <p class="lead">Change your Shana Studios password. It's one password for your client portal and your Google account (Gmail, Drive and Calendar), because Google signs you in through your portal.</p>
  <form id="f" autocomplete="off">
    <label for="p0">Current password</label>
    <input id="p0" type="password" autocomplete="current-password" required maxlength="128">
    <label for="p1">New password</label>
    <input id="p1" type="password" autocomplete="new-password" required maxlength="128">
    <label for="p2">Type it again</label>
    <input id="p2" type="password" autocomplete="new-password" required maxlength="128">
    <div class="show"><input id="sh" type="checkbox"><label for="sh" style="margin:0;font-weight:400">Show passwords</label></div>
    <div class="rules">At least 8 characters. A longer phrase is stronger than a short word with symbols.</div>
    <button id="go" type="submit">Change password</button>
  </form>
  <div id="out" aria-live="polite"></div>
${migrate ? moveSection : ""}
  <footer>Use the new password the next time the portal or Google asks you to sign in.<br><br><a href="#" id="out-link">Sign out</a></footer>
</main>
<script>
const f = document.getElementById("f"), out = document.getElementById("out"), go = document.getElementById("go");
document.getElementById("out-link").addEventListener("click", async (e) => { e.preventDefault(); await fetch("/logout", { method: "POST" }); location.reload(); });
document.getElementById("sh").addEventListener("change", (e) => {
  for (const id of ["p0","p1","p2"]) document.getElementById(id).type = e.target.checked ? "text" : "password";
});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function show(html, err){ out.innerHTML = '<div class="msg' + (err ? ' err' : '') + '">' + html + '</div>'; }
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p0 = document.getElementById("p0").value, p1 = document.getElementById("p1").value, p2 = document.getElementById("p2").value;
  if (p1 !== p2) return show("The two new passwords don't match.", true);
  go.disabled = true; go.textContent = "Changing";
  try {
    const r = await fetch("/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: p0, password: p1 }) });
    const j = await r.json();
    if (!r.ok) { show(esc(j.error || "Something went wrong."), true); return; }
    const changed = j.results[0] && j.results[0].ok;
    out.innerHTML = '<div class="msg' + (changed ? '' : ' err') + '">' + (changed ? "Done. Your new password works for the portal and Google." : "The password was not changed. Tell Aaron.") + '</div>'
      + '<ul class="results">' + j.results.map(x => '<li class="' + (x.ok ? 'ok' : 'bad') + '"><span class="i">' + (x.ok ? '✓' : '!') + '</span><span><b>' + esc(x.label) + '</b><small>' + esc(x.detail) + '</small></span></li>').join("") + '</ul>';
    if (changed) f.reset();
  } catch { show("Lost the connection. Refresh and try again.", true); }
  finally { go.disabled = false; go.textContent = "Change password"; }
});
</script>
${migrate ? moveScript : ""}
</body>
</html>`;
}

const moveSection = `
  <section id="move" style="margin-top:56px;padding-top:32px;border-top:1.5px solid ${S.line}">
    <h2 style="font:400 2rem/1.1 ${S.serif};margin:0 0 8px">Move from your old Gmail</h2>
    <p class="lead" style="margin-bottom:8px">Copies your email (with its labels) and your calendars from your old Gmail account into your Shana Studios account. Nothing in the old account is changed or deleted.</p>
    <ol class="steps" style="padding-left:1.2rem;margin:16px 0 0">
      <li style="margin-bottom:14px"><b>Old account.</b> <span id="src-state">Not connected.</span><br><button type="button" class="alt" id="src-btn">Connect old Gmail</button></li>
      <li style="margin-bottom:14px"><b>Shana Studios account.</b> <span id="dst-state">Not connected.</span><br><button type="button" class="alt" id="dst-btn">Connect Shana Studios account</button></li>
      <li><b>Copy.</b>
        <div class="show"><input id="m-mail" type="checkbox" checked><label for="m-mail" style="margin:0;font-weight:400">Email</label>
        <input id="m-cal" type="checkbox" checked style="margin-left:16px"><label for="m-cal" style="margin:0;font-weight:400">Calendars</label></div>
        <button type="button" id="m-go" disabled>Start copying</button>
      </li>
    </ol>
    <div id="m-out" aria-live="polite"></div>
    <p class="rules">Google may say the app isn't verified. It's the studio's own tool: choose Advanced, then continue. Running it again later is safe: anything already copied is skipped. When the copy ends, the tool's access to both accounts is removed.</p>
    <p class="rules"><a href="#" id="m-reset">Disconnect both accounts</a></p>
  </section>`;

const moveScript = `<script>
(function(){
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);
  let timer = null;
  function render(s){
    const p = s.progress, running = p.state === "running";
    $("src-state").textContent = s.source ? "Connected: " + s.source.email : "Not connected.";
    $("dst-state").textContent = s.target ? "Connected: " + s.target.email : "Not connected (use " + s.targetEmail + ").";
    $("src-btn").textContent = s.source ? "Use a different account" : "Connect old Gmail";
    $("dst-btn").textContent = s.target ? "Connect again" : "Connect Shana Studios account";
    $("src-btn").disabled = $("dst-btn").disabled = running;
    $("m-go").disabled = running || !s.source || !s.target;
    $("m-go").textContent = running ? "Copying" : "Start copying";
    let html = "";
    if (s.error) html += '<div class="msg err">' + esc(s.error) + '</div>';
    if (p.state !== "idle") {
      const m = p.mail, c = p.calendar;
      const head = running ? esc(p.message) + "…" : p.state === "done" ? "Finished." : "Stopped: " + esc(p.message);
      html += '<div class="msg' + (p.state === "failed" ? " err" : "") + '"><b>' + head + '</b>'
        + '<ul class="results">'
        + '<li class="ok"><span class="i">✉</span><span><b>Email</b><small>' + m.copied + ' copied, ' + m.already + ' already there, ' + m.skipped + ' drafts or chats left out' + (m.failed ? ', ' + m.failed + ' could not be copied' : '') + (m.total ? ' (old account has about ' + m.total + ')' : '') + '</small></span></li>'
        + '<li class="ok"><span class="i">◷</span><span><b>Calendars</b><small>' + c.calendars + ' calendars, ' + c.copied + ' events copied' + (c.skipped ? ', ' + c.skipped + ' special events left out' : '') + (c.failed ? ', ' + c.failed + ' could not be copied' : '') + (c.others ? '. ' + c.others + ' calendars other people share with you were left as they are' : '') + '</small></span></li>'
        + '</ul>'
        + (p.errors.length && !running ? '<small style="display:block;margin-top:10px;color:${S.alert}">' + p.errors.slice(-5).map(esc).join("<br>") + '</small>' : '')
        + '</div>';
    }
    $("m-out").innerHTML = html;
    clearTimeout(timer);
    if (running) timer = setTimeout(load, 3000);
  }
  async function load(){
    try { const r = await fetch("/migrate/status"); if (r.ok) render(await r.json()); } catch {}
  }
  async function post(path, body){
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) });
    const j = await r.json();
    if (!r.ok) { $("m-out").innerHTML = '<div class="msg err">' + esc(j.error || "Something went wrong.") + '</div>'; return null; }
    return j;
  }
  async function connect(role){ const j = await post("/migrate/connect", { role }); if (j) location.href = j.url; }
  $("src-btn").addEventListener("click", () => connect("source"));
  $("dst-btn").addEventListener("click", () => connect("target"));
  $("m-go").addEventListener("click", async () => { const j = await post("/migrate/start", { mail: $("m-mail").checked, calendar: $("m-cal").checked }); if (j) render(j); });
  $("m-reset").addEventListener("click", async (e) => { e.preventDefault(); const j = await post("/migrate/disconnect"); if (j) render(j); });
  load();
})();
</script>`;

/** Shown for a moment after Google sends her back; a same-site reload then
 * carries her sign-in cookie again. */
export function callbackHtml(problem) {
  return `${head("Account settings · Shana Studios")}<main>
  <img class="mark" src="/logo.png" alt="Shana Studios">
  <h1>${problem ? "Try again" : "One moment"}</h1>
  <p class="lead">${problem ? esc(problem) : "Taking you back to your account page."}</p>
  <p><a href="/#move">Back to the account page</a></p>
</main>
${problem ? "" : '<script>location.replace("/#move");</script>'}
</body>
</html>`;
}

export function signInHtml() {
  return `${head("Account settings · Shana Studios")}<main>
  <img class="mark" src="/logo.png" alt="Shana Studios">
  <h1>Account settings</h1>
  <p class="lead">Sign in with your Shana Studios username and password.</p>
  <form id="f" autocomplete="on">
    <label for="u">Username</label>
    <input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required maxlength="128">
    <label for="p">Password</label>
    <input id="p" name="password" type="password" autocomplete="current-password" required maxlength="128">
    <button id="go" type="submit">Sign in</button>
  </form>
  <div id="out" aria-live="polite"></div>
</main>
<script>
const f = document.getElementById("f"), out = document.getElementById("out"), go = document.getElementById("go");
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  go.disabled = true; go.textContent = "Checking";
  try {
    const r = await fetch("/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: document.getElementById("u").value, password: document.getElementById("p").value }) });
    if (r.ok) { location.reload(); return; }
    const j = await r.json();
    out.innerHTML = '<div class="msg err">' + esc(j.error || "Something went wrong.") + '</div>';
  } catch { out.innerHTML = '<div class="msg err">Lost the connection. Try again.</div>'; }
  go.disabled = false; go.textContent = "Sign in";
});
</script>
</body>
</html>`;
}
