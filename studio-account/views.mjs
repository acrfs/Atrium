// The account page and the confirmation email, in the Shana Studios look
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

export function pageHtml(cfg) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Your password · Shana Studios</title>
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
  ol.steps { padding: 0; margin: 0 0 32px; list-style: none; counter-reset: s; }
  ol.steps > li { counter-increment: s; position: relative; padding: 0 0 24px 48px; }
  ol.steps > li::before { content: counter(s); position:absolute; left:0; top:-2px; width:32px; height:32px; border-radius:50%;
    background:${S.pink}; color:var(--ink); font: 620 1rem/32px ${S.cta}; font-variation-settings: "SOFT" 100; text-align:center; }
  h2 { font: 400 1.6rem/1.2 ${S.serif}; margin: 0 0 6px; }
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
<main>
  <img class="mark" src="/logo.png" alt="Shana Studios">
  <h1>Change your password</h1>
  <p class="lead">One password for your studio email, your client portal and your website's contact form. Change it in two steps.</p>
  <ol class="steps">
    <li>
      <h2>Change it in your mailbox</h2>
      Open <a href="${esc(cfg.webmailUrl)}" target="_blank" rel="noopener">Titan webmail</a>, sign in as ${esc(cfg.mailbox)}, then go to Settings, Preferences, Change Password.
    </li>
    <li>
      <h2>Bring it everywhere else</h2>
      Type the new password here. We check it with your mailbox first, then update the portal and the website.
      <form id="f" autocomplete="off">
        <label for="p1">New password</label>
        <input id="p1" type="password" autocomplete="new-password" required maxlength="50">
        <label for="p2">Type it again</label>
        <input id="p2" type="password" autocomplete="new-password" required maxlength="50">
        <div class="show"><input id="sh" type="checkbox"><label for="sh" style="margin:0;font-weight:400">Show password</label></div>
        <div class="rules">8 to 50 characters, with an uppercase letter, a lowercase letter, a number and a symbol.</div>
        <button id="go" type="submit">Update everywhere</button>
      </form>
      <div id="out" aria-live="polite"></div>
    </li>
  </ol>
  <footer>Mail apps on your phone or computer will ask for the new password the next time they check mail. That part can't be done from here.</footer>
</main>
<script>
const f = document.getElementById("f"), out = document.getElementById("out"), go = document.getElementById("go");
document.getElementById("sh").addEventListener("change", (e) => {
  for (const id of ["p1","p2"]) document.getElementById(id).type = e.target.checked ? "text" : "password";
});
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]);}
function show(html, err){ out.innerHTML = '<div class="msg' + (err ? ' err' : '') + '">' + html + '</div>'; }
f.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = document.getElementById("p1").value, p2 = document.getElementById("p2").value;
  if (p1 !== p2) return show("The two passwords don't match.", true);
  go.disabled = true; go.textContent = "Updating, this takes about two minutes";
  show("Checking with your mailbox, then updating the portal and the website. Keep this page open.");
  try {
    const r = await fetch("/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: p1 }) });
    const j = await r.json();
    if (!r.ok) { show(esc(j.error || "Something went wrong."), true); return; }
    const allOk = j.results.every(x => x.ok);
    out.innerHTML = '<div class="msg' + (allOk ? '' : ' err') + '">' + (allOk ? "All done. Your new password works everywhere." : "Most of it worked. The places marked below still need attention; tell Aaron.") + '</div>'
      + '<ul class="results">' + j.results.map(x => '<li class="' + (x.ok ? 'ok' : 'bad') + '"><span class="i">' + (x.ok ? '✓' : '!') + '</span><span><b>' + esc(x.label) + '</b><small>' + esc(x.detail) + '</small></span></li>').join("") + '</ul>';
    if (allOk) f.reset();
  } catch { show("Lost the connection. Refresh and try again; nothing is shown to anyone.", true); }
  finally { go.disabled = false; go.textContent = "Update everywhere"; }
});
</script>
</body>
</html>`;
}

export function emailHtml(results) {
  const rows = results
    .map(
      (r) => `<tr><td style="padding:10px 0;border-top:1px solid ${S.line};font:16px/1.5 ${S.sans};color:${S.indigo}">
        <strong style="font-weight:500">${r.ok ? "✓" : "!"} ${esc(r.label)}</strong><br>
        <span style="color:${S.peri};font-size:14px">${esc(r.detail)}</span></td></tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Outfit:wght@400;500&display=swap" rel="stylesheet"></head>
<body style="margin:0;background:${S.paper}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${S.paper}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td><img src="${S.logo}" width="48" height="48" alt="Shana Studios" style="display:block;margin-bottom:20px"></td></tr>
<tr><td style="font:400 36px/1.1 ${S.serif};color:${S.indigo};padding-bottom:12px">Your password was updated</td></tr>
<tr><td style="font:16px/1.55 ${S.sans};color:${S.indigo};padding-bottom:20px">You just changed your Shana Studios password. Here is where it was updated:</td></tr>
${rows}
<tr><td style="font:14px/1.5 ${S.sans};color:${S.peri};padding-top:24px">If this wasn't you, change your password in Titan webmail right away and tell Aaron. Mail apps on your phone or computer will ask for the new password once.</td></tr>
<tr><td style="font:14px/1.5 ${S.sans};color:${S.peri};padding-top:32px">Shana Studios · <a href="https://shanastudios.co" style="color:${S.indigo}">shanastudios.co</a></td></tr>
</table></td></tr></table></body></html>`;
}
