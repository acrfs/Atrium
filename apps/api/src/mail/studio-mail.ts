/**
 * Shana Studios mail helpers (local modification, see MODIFICATIONS.md).
 */
import { render } from "@react-email/render";
import { StudioNoticeEmail } from "@atrium/email";

/**
 * Adds a display name to a bare sender address, so inboxes show
 * "Shana Studios" instead of the address. Set by EMAIL_FROM_NAME (unset: address only);
 * an address that already carries a name ("Name <a@b>") is left alone.
 */
export function withSenderName(from: string): string {
  const name: string = (process.env.EMAIL_FROM_NAME ?? "").trim();
  if (!name || !from || from.includes("<")) return from;
  return `"${name.replace(/"/g, "")}" <${from.trim()}>`;
}

/** The settings page's test email, in the studio look. */
export function testEmailHtml(): Promise<string> {
  return render(
    StudioNoticeEmail({
      heading: "Your email is set up",
      paragraphs: [
        "This is a test from your Shana Studios client portal.",
        "If you're reading it, invitations, updates and reminders will reach your clients from this address.",
      ],
    }),
  );
}
