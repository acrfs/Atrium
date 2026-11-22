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

3. Move from the old Gmail (shown only when `GOOGLE_MIGRATE_CLIENT_ID` and
   `GOOGLE_MIGRATE_CLIENT_SECRET` are set): she connects her old Gmail account (read
   only) and her Shana Studios account, then presses Start copying. `migrate.mjs` copies
   email with labels (Gmail API `messages.import`, drafts and chats left out, spam and
   trash not copied) and her own calendars (`events.import` by iCalUID; cancelled
   occurrences of repeating events become EXDATEs; birthdays, out of office and other
   special event types and calendars shared with her are left out). Running it again is
   safe: a message whose Message-ID is already in the new mailbox is skipped, and an
   event with the same iCalUID is updated instead of duplicated. Google tokens live only
   in memory and are revoked when the copy ends. The old account is never changed.

   Google setup: a Google Cloud project with the Gmail and Calendar APIs, OAuth audience
   **External** in **Testing** with both addresses as test users (an Internal app can't
   sign in a gmail.com account), and a Web client with redirect
   `https://account.shanastudios.co/google/callback`. Testing-mode sign-ins show an
   "unverified app" notice and their tokens expire after 7 days, which is fine for a
   one-time move.

Limits: 5 tries per 15 minutes per address, 20 overall, one change at a time.

## Settings (environment)

| Variable | Default | Notes |
| --- | --- | --- |
| `PORTAL_LOGIN_EMAIL` | shana@shanastudios.co | Portal account the page manages; also the username |
| `STUDIO_SYNC_TOKEN` | (required) | Same random value (32+ chars) as on the portal container |
| `PORTAL_INTERNAL_URL` | http://atrium:8080 | Portal on the Docker network |
| `GOOGLE_MIGRATE_CLIENT_ID` / `GOOGLE_MIGRATE_CLIENT_SECRET` | (unset: no move section) | OAuth Web client for the Gmail move |
| `MIGRATE_SOURCE_EMAIL` | (any) | Optional: the only old address accepted, e.g. shanatstudios@gmail.com |
| `MIGRATE_TARGET_EMAIL` | `PORTAL_LOGIN_EMAIL` | The new account the copy goes into |
| `ACCOUNT_PUBLIC_URL` | https://account.shanastudios.co | Used for the Google redirect address |

## Run

```
npm test                  # unit tests (no dependencies)
docker build -t studio-account:5 .
```

On the server it runs as the `account` service in ~/atrium/compose.yaml, behind the
same Caddy as the portal. Caddy must also answer 404 for `/api/internal/*` on the
portal's public hostname so the internal endpoints are only reachable inside Docker.
