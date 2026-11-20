#!/usr/bin/env python3
"""Adds the account service to ~/atrium on the portal server (backs up first).

Usage: python3 apply.py <portal-image-tag> <portal-login-email>
Edits compose.yaml and Caddyfile in place, keeping .bak-<timestamp> copies.
Stops without changing anything if the files don't look as expected.
"""
import pathlib, shutil, sys, time

tag, login = sys.argv[1], sys.argv[2]
root = pathlib.Path.home() / "atrium"
compose, caddy = root / "compose.yaml", root / "Caddyfile"
c, k = compose.read_text(), caddy.read_text()

def need(cond, msg):
    if not cond:
        sys.exit(f"Stopped, nothing changed: {msg}")

need("image: shana-atrium:" in c, "no shana-atrium image line")
need("account:" not in c, "account service already present")
need("portal.shanastudios.co {\n    reverse_proxy atrium:8080\n}" in k, "Caddyfile portal block differs")

lines = c.splitlines()
out = []
for line in lines:
    if line.strip().startswith("image: shana-atrium:"):
        line = line.split("shana-atrium:")[0] + f"shana-atrium:{tag}"
    out.append(line)
    if line.strip() == "BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}":
        out.append(line.replace("BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET}", "STUDIO_SYNC_TOKEN: ${STUDIO_SYNC_TOKEN}"))
c2 = "\n".join(out) + "\n"
need("STUDIO_SYNC_TOKEN" in c2, "could not add STUDIO_SYNC_TOKEN")

service = f"""  account:
    image: studio-account:1
    environment:
      STUDIO_SYNC_TOKEN: ${{STUDIO_SYNC_TOKEN}}
      VERCEL_TOKEN: ${{VERCEL_TOKEN}}
      VERCEL_TEAM: acrfs-projects
      VERCEL_PROJECT: shana-studios
      MAILBOX: shana@shanastudios.co
      PORTAL_LOGIN_EMAIL: {login}
    depends_on:
      - atrium
    restart: unless-stopped
"""
need("\nvolumes:\n" in c2, "no top-level volumes section")
c2 = c2.replace("\nvolumes:\n", "\n" + service + "volumes:\n", 1)

k2 = k.replace(
    "portal.shanastudios.co {\n    reverse_proxy atrium:8080\n}",
    "portal.shanastudios.co {\n    respond /api/internal/* 404\n    reverse_proxy atrium:8080\n}\n\naccount.shanastudios.co {\n    reverse_proxy account:8090\n}",
    1,
)

ts = time.strftime("%Y%m%d-%H%M%S")
shutil.copy(compose, f"{compose}.bak-{ts}")
shutil.copy(caddy, f"{caddy}.bak-{ts}")
compose.write_text(c2)
caddy.write_text(k2)
print(f"Updated compose.yaml and Caddyfile (backups .bak-{ts})")
