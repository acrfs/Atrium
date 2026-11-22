import type { GoogleCalendarConfig } from "./google-calendar.config";
import { GOOGLE_CALENDAR_SCOPES } from "./google-calendar.config";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API = "https://www.googleapis.com/calendar/v3";

/** A Google event's start or end: `date` for all-day events, `dateTime` otherwise. */
export interface GoogleEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start?: GoogleEventTime;
  end?: GoogleEventTime;
  extendedProperties?: { private?: Record<string, string> };
}

/** The writable fields of an event. */
export interface GoogleEventBody {
  summary: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  transparency?: "opaque" | "transparent";
  source?: { title: string; url: string };
  extendedProperties?: { private: Record<string, string> };
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

export interface EventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
}

/** A non-2xx answer from Google. `status` 401/403 with invalid_grant means access was revoked. */
export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

/** Thin wrapper over the Google OAuth and Calendar v3 REST endpoints. */
export class GoogleCalendarClient {
  constructor(
    private cfg: GoogleCalendarConfig,
    private fetchFn: FetchLike = (input: string, init?: RequestInit) => fetch(input, init),
  ) {}

  authorizeUrl(state: string, loginHint?: string): string {
    const params = new URLSearchParams({
      client_id: this.cfg.clientId,
      redirect_uri: this.cfg.redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      access_type: "offline",
      // Always ask, so Google returns a refresh token even on a reconnect.
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });
    if (loginHint) params.set("login_hint", loginHint);
    return `${AUTH_URL}?${params.toString()}`;
  }

  exchangeCode(code: string): Promise<TokenResponse> {
    return this.tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.cfg.redirectUri,
    });
  }

  refresh(refreshToken: string): Promise<TokenResponse> {
    return this.tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
  }

  async revoke(token: string): Promise<void> {
    await this.fetchFn(`${REVOKE_URL}?${new URLSearchParams({ token }).toString()}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
  }

  /** The primary calendar; its id is the account's email address. */
  primaryCalendar(accessToken: string): Promise<{ id: string; timeZone?: string }> {
    return this.api(accessToken, "GET", "/calendars/primary");
  }

  createCalendar(accessToken: string, summary: string, timeZone?: string): Promise<{ id: string }> {
    return this.api(accessToken, "POST", "/calendars", {
      summary,
      description: "Deadlines, project dates and invoice due dates from the client portal. Kept in sync automatically.",
      ...(timeZone ? { timeZone } : {}),
    });
  }

  getCalendar(accessToken: string, calendarId: string): Promise<{ id: string }> {
    return this.api(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}`);
  }

  /** Removes a calendar the portal created. Already gone counts as done. */
  async deleteCalendar(accessToken: string, calendarId: string): Promise<void> {
    try {
      await this.api(accessToken, "DELETE", `/calendars/${encodeURIComponent(calendarId)}`);
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  listEvents(accessToken: string, calendarId: string, params: Record<string, string>): Promise<EventsPage> {
    const qs = new URLSearchParams(params).toString();
    return this.api(accessToken, "GET", `/calendars/${encodeURIComponent(calendarId)}/events?${qs}`);
  }

  insertEvent(accessToken: string, calendarId: string, body: GoogleEventBody): Promise<GoogleEvent> {
    return this.api(accessToken, "POST", `/calendars/${encodeURIComponent(calendarId)}/events`, body);
  }

  patchEvent(accessToken: string, calendarId: string, eventId: string, body: Partial<GoogleEventBody>): Promise<GoogleEvent> {
    return this.api(
      accessToken,
      "PATCH",
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      body,
    );
  }

  /** Deleting an event that is already gone (404/410) counts as done. */
  async deleteEvent(accessToken: string, calendarId: string, eventId: string): Promise<void> {
    try {
      await this.api(
        accessToken,
        "DELETE",
        `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      );
    } catch (err) {
      if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return;
      throw err;
    }
  }

  private async tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
    const res: Response = await this.fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        ...fields,
      }).toString(),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || typeof data.access_token !== "string") {
      const reason: string = typeof data.error === "string" ? data.error : "token_error";
      throw new GoogleApiError(res.status, reason, `Google token request failed: ${reason}`);
    }
    return data as unknown as TokenResponse;
  }

  private async api<T>(accessToken: string, method: string, path: string, body?: unknown): Promise<T> {
    const res: Response = await this.fetchFn(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = (data.error ?? {}) as { message?: string; errors?: Array<{ reason?: string }>; status?: string };
      const reason: string = error.errors?.[0]?.reason ?? error.status ?? "error";
      throw new GoogleApiError(res.status, reason, `Google Calendar ${method} ${path.split("?")[0]} failed (${res.status}): ${error.message ?? reason}`);
    }
    return data as T;
  }
}
