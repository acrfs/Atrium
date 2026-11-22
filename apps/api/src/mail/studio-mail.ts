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

/**
 * Where replies go when the portal sends from a send-only address such as
 * notifications@portal.shanastudios.co. Set by EMAIL_REPLY_TO (unset: no Reply-To).
 * Spread into the send options of every outgoing email.
 */
export function replyToFields(): { replyTo?: string } {
  const address: string = (process.env.EMAIL_REPLY_TO ?? "").trim();
  return address ? { replyTo: address } : {};
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

/** Sent after a password change on account.shanastudios.co. Never contains the password. */
export function passwordChangedEmailHtml(): Promise<string> {
  return render(
    StudioNoticeEmail({
      heading: "Your password was changed",
      paragraphs: [
        "Your Shana Studios password was just changed on account.shanastudios.co.",
        "It's the password for your client portal and for your Google account (Gmail, Drive and Calendar), so use the new one the next time either asks you to sign in.",
        "If this wasn't you, tell Aaron right away.",
      ],
      buttonLabel: "Account settings",
      buttonUrl: "https://account.shanastudios.co",
    }),
  );
}
