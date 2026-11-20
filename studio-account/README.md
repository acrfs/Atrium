# studio-account

Shana's password page at **account.shanastudios.co**. She changes her password in
Titan webmail, then types it here once. The page:

1. signs in to Titan's mail server with it (IMAP, imap.titan.email:993). This proves
   the mailbox password really is the new one, and nothing else happens if it fails;
2. sets her portal sign-in password and the portal's SMTP password, through the
   portal's internal endpoint `POST /api/internal/studio-sync/password`
   (apps/api/src/studio-sync, needs `STUDIO_SYNC_TOKEN` on both containers);
3. updates `SMTP_PASS` on the Vercel project `shana-studios` and redeploys production
   so the website's lead form uses it;
4. sends a branded confirmation email from the mailbox (never containing the password).

Titan itself can't be set automatically: Hostinger's API lists no Titan mail orders
(tested 2026-11-20) and Titan's own API is for resellers only.

Limits: 5 tries per 15 minutes per address, 20 overall, one change at a time.

## Settings (environment)

| Variable | Default | Notes |
| --- | --- | --- |
| `MAILBOX` | shana@shanastudios.co | Titan mailbox, also the SMTP user to update in the portal |
| `PORTAL_LOGIN_EMAIL` | same as `MAILBOX` | Portal account whose sign-in password is set |
| `STUDIO_SYNC_TOKEN` | (required) | Same random value (32+ chars) as on the portal container |
| `PORTAL_INTERNAL_URL` | http://atrium:8080 | Portal on the Docker network |
| `VERCEL_TOKEN` | (required) | Vercel access token with access to the project |
| `VERCEL_TEAM` | | Vercel team slug, e.g. acrfs-projects |
| `VERCEL_PROJECT` | shana-studios | |
| `VERCEL_ENV_KEY` | SMTP_PASS | |

## Run

```
npm ci && npm test        # unit tests
docker build -t studio-account:1 .
```

On the server it runs as the `account` service in ~/atrium/compose.yaml, behind the
same Caddy as the portal. Caddy must also answer 404 for `/api/internal/*` on the
portal's public hostname so the internal endpoint is only reachable inside Docker.
