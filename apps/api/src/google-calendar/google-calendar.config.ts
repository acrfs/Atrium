import { publicApiUrl } from "../common/helpers/public-api-url";

type ConfigLike = { get: (key: string) => string | undefined };

/** Everything the Google Calendar sync needs, or null when it is off. */
export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  /** Must be listed as an authorized redirect URI on the Google OAuth client. */
  redirectUri: string;
  webUrl: string;
}

/** The callback Google sends the browser back to after consent. */
export function googleCalendarRedirectUri(config: ConfigLike): string {
  return `${publicApiUrl(config)}/api/google-calendar/callback`;
}

/**
 * Reads GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET (an OAuth
 * "Web application" client from Google Cloud). The sync is off unless both are set.
 */
export function loadGoogleCalendarConfig(config: ConfigLike): GoogleCalendarConfig | null {
  const clientId: string = (config.get("GOOGLE_CALENDAR_CLIENT_ID") ?? "").trim();
  const clientSecret: string = (config.get("GOOGLE_CALENDAR_CLIENT_SECRET") ?? "").trim();
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    redirectUri: googleCalendarRedirectUri(config),
    webUrl: (config.get("WEB_URL") || "http://localhost:3000").replace(/\/+$/, ""),
  };
}

/**
 * calendar.events: read and write events on calendars the account can edit.
 * calendar.app.created: create the "portal" calendar and manage what is on it.
 * calendar.calendarlist.readonly: read the account's primary calendar id (its email).
 */
export const GOOGLE_CALENDAR_SCOPES: readonly string[] = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.app.created",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
];
