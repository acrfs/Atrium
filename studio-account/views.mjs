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

export function pageHtml() {
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
