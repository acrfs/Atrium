# Modified copy of Atrium

This is a modified copy of [Atrium](https://github.com/Vibra-Labs/Atrium) by Vibra Labs,
changed for use as the Shana Studios client portal. Atrium is licensed under the
Elastic License 2.0 (see `LICENSE`), and that license continues to apply to this copy.

Changes made to the original software:

- Invoice PDFs can be drawn on a studio letterhead (`apps/api/src/invoices/invoice-letterhead.ts`,
  assets in `apps/api/assets/invoice-shana/`), turned on with `INVOICE_ASSETS_DIR`.
- The web app carries a studio theme that follows the Shana Studios portfolio site:
  fonts, colors, corner shapes, a pill navigation for the client portal, a new welcome
  page, and a single light theme (`apps/web/src/app/studio-theme.css`, `apps/web/src/lib/studio.tsx`).
- Default brand color, default project status colors and email button colors use the studio palette.
- The app icons in `apps/web/public` are the studio's mark.
- Every email uses the Shana Studios look: templates import studio stand-ins for the
  react-email components (`packages/email/src/studio.tsx`), a studio test email
  (`packages/email/src/templates/studio-notice.tsx`, `apps/api/src/mail/studio-mail.ts`),
  an optional sender name (`EMAIL_FROM_NAME`), and "Atrium" removed from subjects and wording.

- The portal is invite only: Sign up sends new visitors to the contact chat on the studio's site,
  and user-facing "Atrium" wording names the portal or the studio instead.

Fonts added: Inter (web text), Instrument Serif (web wordmark and emails), Fraunces and Outfit (emails),
Outfit (invoice PDFs), all under the SIL Open Font License 1.1.

- Password page for the studio owner: internal endpoints (`apps/api/src/studio-sync/`), off unless
  `STUDIO_SYNC_TOKEN` is set, that check and set one user's sign-in password and email her a notice,
  used by the separate `studio-account/` service (account.shanastudios.co). That password is also her
  Google Workspace sign-in (see the Google entry below). `MailService` gained `clearSmtpTransporters()`
  so a changed SMTP password applies at once.

- `EMAIL_REPLY_TO`: when set, every email the portal sends carries that Reply-To, so mail sent from a
  send-only address (notifications@portal.shanastudios.co) is answered to the studio's own inbox.

- A Developer role (`developer`) for whoever runs the portal's technical side: workspace and email
  settings, branding, integration destinations and sign-in security, with no access to projects,
  clients, contacts, files, invoices or search. Only the settings, branding, integrations and team
  controllers grant it (`apps/api/src/clients/developer-role.spec.ts` enforces that). Developers are
  invited as admins and the pending invitation is switched (`PUT /clients/invitations/:id/role`).

- Google Workspace sign-in through the portal (`apps/api/src/google-sso/`): a minimal OpenID Connect
  identity provider at `/api/sso/google` (discovery, authorize, token, userinfo, JWKS; RS256 id_tokens)
  for one client, a Google Workspace third-party SSO profile. Off unless `GOOGLE_SSO_CLIENT_ID`,
  `GOOGLE_SSO_CLIENT_SECRET` (32+ chars), `GOOGLE_SSO_PRIVATE_KEY` (RSA PEM, or base64 of it) and
  `GOOGLE_SSO_ALLOWED_DOMAINS` are set; `GOOGLE_SSO_REDIRECT_URIS` lists the exact redirect URIs Google
  shows. A signed-out user is sent to `/login?next=...` and returns to Google after signing in.

- Bill.com invoice payments (`apps/api/src/payments/billcom/`), shown in Settings > Billing in place
  of Stripe. The owner signs in with their BILL account and developer key (stored encrypted). When a
  client presses Pay, the invoice is created in BILL and the client goes to BILL's hosted payment page
  (bank transfer or card). The invoice is marked paid when BILL reports `PAID_IN_FULL`, from BILL's
  `invoice.updated` webhook (`POST /api/payments/billcom/webhook/:orgId`, status re-read from BILL)
  and a 10 minute poll. New columns on `SystemSettings` and `Invoice` and a `BillcomCustomer` model.
  Stripe checkout still runs, through the same shared access checks, when Bill.com is not connected.

- Deleting a project now deletes its unpaid invoices with it; paid invoices stay as records with no
  project. Invoices without a project are listed at `/dashboard/invoices` (API `projectId=none`), and
  the dashboard's overdue list and the calendar link there instead of to a project that no longer exists.

- Required passkeys for staff (`SystemSettings.requirePasskey`, Settings > Security > "Require
  passkeys for staff", `PUT /api/two-factor/passkey-requirement`, owner-only, needs the owner's own
  passkey). Owners, admins and developers then need a passkey and must sign in with it: without one
  they can only add one (`PASSKEY_REQUIRED`, `/2fa/setup` offers passkeys only), and a session that
  passed the authenticator app, a recovery code or a trusted device must sign in again with the
  passkey (`PASSKEY_SIGN_IN_REQUIRED`). Their last passkey can't be removed. Clients are never asked.
  Google Workspace sign-in (`/api/sso/google/authorize`) follows the same rule. The second-factor gate
  now also holds developers to the existing "Require two-factor for staff" setting. Recovery: an owner
  resets another member from Team; a locked-out owner needs `script:disable-2fa <email> --passkeys`
  on the server, then adds a new passkey at the next sign-in.

- Two-way Google Calendar sync (`apps/api/src/google-calendar/`), controlled from the Calendar page
  (Google Calendar button, New event). An owner or admin connects one Google account per workspace
  with OAuth (`GOOGLE_CALENDAR_CLIENT_ID` / `GOOGLE_CALENDAR_CLIENT_SECRET`, redirect URI
  `<API_URL>/api/google-calendar/callback`; tokens stored encrypted). Every five minutes, and on
  "Sync now": open tasks, project start and end dates and sent or overdue invoices are written as
  all-day events to a separate "<workspace> portal" calendar the portal creates in that account, and
  events from the account's primary calendar are cached (`GoogleCalendarEvent`) and shown in the
  portal calendar as `google_event`. Google events can be created, edited and deleted from the
  portal. New models `GoogleCalendarConnection`, `GoogleCalendarEvent`, `GoogleCalendarPush`.
