# studio-account

Shana's account page at **account.shanastudios.co**. Her portal password is also her
Google Workspace sign-in (the portal is Google's OIDC identity provider, see
`apps/api/src/google-sso`), so this page changes one password that covers both. Google
Admin's SSO profile points its "Change password URL" here.

1. Sign-in: username (her address, full or the part before the @) and her current
   password, checked by the portal through `POST /api/internal/studio-sync/verify`.
   Wrong username and wrong password get the same answer.
2. Change: current password again, then the new one (8 to 128 characters, the portal's
   rule). The portal sets it through `POST /api/internal/studio-sync/password`
   (`apps/api/src/studio-sync`) and emails her a notice through the workspace's own
   email setting. The notice never contains the password.

The portal's and the website's automated email no longer use her password: they send
from notifications@portal.shanastudios.co, which has its own password.

Limits: 5 tries per 15 minutes per address, 20 overall, one change at a time.

## Settings (environment)

| Variable | Default | Notes |
| --- | --- | --- |
| `PORTAL_LOGIN_EMAIL` | shana@shanastudios.co | Portal account the page manages; also the username |
| `STUDIO_SYNC_TOKEN` | (required) | Same random value (32+ chars) as on the portal container |
| `PORTAL_INTERNAL_URL` | http://atrium:8080 | Portal on the Docker network |

## Run

```
npm test                  # unit tests (no dependencies)
docker build -t studio-account:4 .
```

On the server it runs as the `account` service in ~/atrium/compose.yaml, behind the
same Caddy as the portal. Caddy must also answer 404 for `/api/internal/*` on the
portal's public hostname so the internal endpoints are only reachable inside Docker.
