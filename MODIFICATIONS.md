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

Fonts added: DM Sans and Instrument Serif (web), Outfit (invoice PDFs), all under the
SIL Open Font License 1.1.
