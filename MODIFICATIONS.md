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

Fonts added: Instrument Serif, Fraunces and Outfit (web and emails), Outfit (invoice PDFs), all under the
SIL Open Font License 1.1.

- Password sync for the studio owner: an internal endpoint (`apps/api/src/studio-sync/`), off unless
  `STUDIO_SYNC_TOKEN` is set, that sets one user's sign-in password and the matching SMTP password,
  used by the separate `studio-account/` service (account.shanastudios.co). `MailService` gained
  `clearSmtpTransporters()` so a changed SMTP password applies at once.
