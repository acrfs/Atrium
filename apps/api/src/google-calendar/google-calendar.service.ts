import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { CalendarEvent, GoogleCalendarStatus } from "@atrium/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CalendarService } from "../calendar/calendar.service";
import { isValidTimeZone } from "../common/helpers/local-time";
import {
  GoogleApiError,
  GoogleCalendarClient,
  type FetchLike,
  type GoogleEvent,
  type GoogleEventBody,
} from "./google-calendar.client";
import { loadGoogleCalendarConfig, type GoogleCalendarConfig } from "./google-calendar.config";
import { StateSigner, TokenCipher } from "./google-calendar.crypto";
import type { CallbackQuery, GoogleCalendarSettingsDto, GoogleEventInputDto } from "./google-calendar.dto";
import {
  addDays,
  bodyHash,
  fromGoogleEvent,
  shouldPush,
  sourceKey,
  toGoogleBody,
  type CachedEventFields,
} from "./google-calendar.mapping";
import { cachedRowToEvents, type CachedRow } from "./google-calendar.events";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How far back and ahead portal items are written to Google. CalendarService caps a window at 366 days. */
const PUSH_PAST_DAYS = 30;
const PUSH_FUTURE_DAYS = 330;
/** Window of Google events read on a full sync. */
const PULL_PAST_DAYS = 60;
const PULL_FUTURE_DAYS = 400;
/** A full re-read once a day keeps recurring events filled in as the window moves. */
const FULL_SYNC_EVERY_MS = DAY_MS;
const PORTAL_TYPES = "task,project_start,project_end,invoice_due";
const REVOKED_MESSAGE = "Google access was revoked or expired. Reconnect Google Calendar.";

type Connection = NonNullable<Awaited<ReturnType<PrismaService["googleCalendarConnection"]["findUnique"]>>>;

/** Two-way sync between the portal calendar and one Google Calendar account per workspace. */
@Injectable()
export class GoogleCalendarService {
  private readonly logger = new Logger(GoogleCalendarService.name);
  private cfg: GoogleCalendarConfig | null;
  private client: GoogleCalendarClient | null;
  private cipher: TokenCipher;
  private states: StateSigner;
  private running = new Set<string>();

  constructor(
    private prisma: PrismaService,
    private calendar: CalendarService,
    config: ConfigService,
  ) {
    this.cfg = loadGoogleCalendarConfig(config);
    this.client = this.cfg ? new GoogleCalendarClient(this.cfg) : null;
    const secret: string = config.get<string>("BETTER_AUTH_SECRET") ?? "";
    this.cipher = new TokenCipher(secret);
    this.states = new StateSigner(secret);
  }

  /** Tests swap in a fake Google. */
  useFetch(fetchFn: FetchLike): void {
    if (this.cfg) this.client = new GoogleCalendarClient(this.cfg, fetchFn);
  }

  get configured(): boolean {
    return this.cfg !== null;
  }

  async status(orgId: string): Promise<GoogleCalendarStatus> {
    const conn = await this.prisma.googleCalendarConnection.findUnique({ where: { organizationId: orgId } });
    return {
      configured: this.configured,
      connected: !!conn,
      googleEmail: conn?.googleEmail ?? null,
      portalCalendarId: conn?.portalCalendarId ?? null,
      pushEnabled: conn?.pushEnabled ?? true,
      pullEnabled: conn?.pullEnabled ?? true,
      lastSyncedAt: conn?.lastSyncedAt?.toISOString() ?? null,
      lastError: conn?.lastError ?? null,
    };
  }

  /** The Google consent URL that starts a connection for this workspace. */
  connectUrl(orgId: string, user: { id: string; email?: string }): string {
    const client = this.requireClient();
    return client.authorizeUrl(this.states.sign(orgId, user.id), user.email);
  }

  /** Finishes the OAuth flow and answers with where to send the browser. */
  async handleCallback(query: CallbackQuery): Promise<string> {
    const webUrl: string = this.cfg?.webUrl ?? "";
    const back = (result: string): string => `${webUrl}/dashboard/calendar?google=${result}`;
    const client = this.client;
    if (!client) return back("not_configured");
    const state = this.states.verify(query.state);
    if (!state) return back("expired");
    if (query.error || !query.code) return back("denied");

    const member = await this.prisma.member.findFirst({
      where: { organizationId: state.o, userId: state.u, role: { in: ["owner", "admin"] } },
      select: { id: true },
    });
    if (!member) return back("forbidden");

    try {
      const tokens = await client.exchangeCode(query.code);
      if (!tokens.refresh_token) return back("no_offline_access");
      const primary = await client.primaryCalendar(tokens.access_token);
      const googleEmail: string = primary.id;

      const existing = await this.prisma.googleCalendarConnection.findUnique({ where: { organizationId: state.o } });
      const sameAccount: boolean = existing?.googleEmail.toLowerCase() === googleEmail.toLowerCase();
      if (existing && !sameAccount) {
        // A different Google account: start over so nothing from the old one lingers.
        await this.prisma.googleCalendarConnection.delete({ where: { id: existing.id } });
      }

      const encrypted = {
        refreshToken: this.cipher.encrypt(tokens.refresh_token),
        accessToken: this.cipher.encrypt(tokens.access_token),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        lastError: null,
      };
      const conn =
        existing && sameAccount
          ? await this.prisma.googleCalendarConnection.update({
              where: { id: existing.id },
              data: { ...encrypted, connectedById: state.u },
            })
          : await this.prisma.googleCalendarConnection.create({
              data: { ...encrypted, organizationId: state.o, connectedById: state.u, googleEmail },
            });

      await this.ensurePortalCalendar(conn, tokens.access_token);
      // First sync before the redirect, so the calendar is filled when the page opens.
      await this.sync(state.o).catch((err: unknown) => this.logger.warn(`First Google sync failed: ${String(err)}`));
      return back("connected");
    } catch (err) {
      this.logger.error("Google Calendar connection failed", err instanceof Error ? err.stack : String(err));
      return back("error");
    }
  }

  async updateSettings(orgId: string, dto: GoogleCalendarSettingsDto): Promise<GoogleCalendarStatus> {
    await this.requireConnection(orgId);
    await this.prisma.googleCalendarConnection.update({
      where: { organizationId: orgId },
      data: {
        ...(dto.pushEnabled !== undefined ? { pushEnabled: dto.pushEnabled } : {}),
        ...(dto.pullEnabled !== undefined ? { pullEnabled: dto.pullEnabled } : {}),
      },
    });
    await this.sync(orgId);
    return this.status(orgId);
  }

  /** Removes the portal's calendar from Google, revokes access and forgets the account. */
  async disconnect(orgId: string): Promise<void> {
    const conn = await this.prisma.googleCalendarConnection.findUnique({ where: { organizationId: orgId } });
    if (!conn) return;
    if (this.client) {
      try {
        const token: string = await this.accessToken(conn);
        if (conn.portalCalendarId) await this.client.deleteCalendar(token, conn.portalCalendarId);
      } catch (err) {
        this.logger.warn(`Could not remove the portal calendar from Google: ${String(err)}`);
      }
      try {
        await this.client.revoke(this.cipher.decrypt(conn.refreshToken));
      } catch (err) {
        this.logger.warn(`Could not revoke the Google token: ${String(err)}`);
      }
    }
    await this.prisma.googleCalendarConnection.delete({ where: { id: conn.id } });
  }

  /** Every connected workspace, one after another (the cron). */
  async syncAll(): Promise<void> {
    if (!this.client) return;
    const conns = await this.prisma.googleCalendarConnection.findMany({ select: { organizationId: true } });
    for (const c of conns) {
      try {
        await this.sync(c.organizationId);
      } catch (err) {
        this.logger.warn(`Google sync failed for a workspace: ${String(err)}`);
      }
    }
  }

  /** Reads Google into the portal and writes the portal into Google. Never runs twice at once per workspace. */
  async sync(orgId: string): Promise<void> {
    if (!this.client || this.running.has(orgId)) return;
    this.running.add(orgId);
    try {
      const conn = await this.prisma.googleCalendarConnection.findUnique({ where: { organizationId: orgId } });
      if (!conn) return;
      try {
        const token: string = await this.accessToken(conn);
        if (conn.pullEnabled) await this.pull(conn, token);
        else await this.prisma.googleCalendarEvent.deleteMany({ where: { connectionId: conn.id } });
        if (conn.pushEnabled) await this.push(conn, token);
        else await this.removePushed(conn, token);
        await this.prisma.googleCalendarConnection.update({
          where: { id: conn.id },
          data: { lastSyncedAt: new Date(), lastError: null },
        });
      } catch (err) {
        const message: string = this.describe(err);
        await this.prisma.googleCalendarConnection
          .update({ where: { id: conn.id }, data: { lastError: message } })
          .catch(() => undefined);
        throw err;
      }
    } finally {
      this.running.delete(orgId);
    }
  }

  /** Makes an event in the connected Google Calendar from the portal. */
  async createEvent(orgId: string, dto: GoogleEventInputDto): Promise<CalendarEvent[]> {
    const conn = await this.requireConnection(orgId);
    const token: string = await this.accessToken(conn);
    const body: GoogleEventBody = await this.eventBody(orgId, dto);
    const created: GoogleEvent = await this.requireClient().insertEvent(token, conn.readCalendarId, body);
    return this.cache(conn, created);
  }

  /** Edits a Google event (one shown in the portal calendar). */
  async updateEvent(orgId: string, id: string, dto: GoogleEventInputDto): Promise<CalendarEvent[]> {
    const conn = await this.requireConnection(orgId);
    const row = await this.requireEvent(orgId, id);
    const token: string = await this.accessToken(conn);
    const body: GoogleEventBody = await this.eventBody(orgId, dto);
    const updated: GoogleEvent = await this.requireClient().patchEvent(token, conn.readCalendarId, row.googleEventId, {
      summary: body.summary,
      description: body.description ?? "",
      location: body.location ?? "",
      start: body.start,
      end: body.end,
    });
    return this.cache(conn, updated);
  }

  async deleteEvent(orgId: string, id: string): Promise<void> {
    const conn = await this.requireConnection(orgId);
    const row = await this.requireEvent(orgId, id);
    const token: string = await this.accessToken(conn);
    await this.requireClient().deleteEvent(token, conn.readCalendarId, row.googleEventId);
    await this.prisma.googleCalendarEvent.delete({ where: { id: row.id } });
  }

  // ---------------------------------------------------------------- internals

  private requireClient(): GoogleCalendarClient {
    if (!this.client) {
      throw new BadRequestException(
        "Google Calendar is not set up on this server (GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET).",
      );
    }
    return this.client;
  }

  private async requireConnection(orgId: string): Promise<Connection> {
    this.requireClient();
    const conn = await this.prisma.googleCalendarConnection.findUnique({ where: { organizationId: orgId } });
    if (!conn) throw new BadRequestException("Google Calendar is not connected");
    return conn;
  }

  private async requireEvent(orgId: string, id: string) {
    const row = await this.prisma.googleCalendarEvent.findFirst({ where: { id, organizationId: orgId } });
    if (!row) throw new NotFoundException("Event not found");
    return row;
  }

  private describe(err: unknown): string {
    if (err instanceof GoogleApiError && (err.reason === "invalid_grant" || err.status === 401)) return REVOKED_MESSAGE;
    if (err instanceof Error) return err.message.slice(0, 500);
    return "Google sync failed";
  }

  /** A live access token, refreshed when it is within a minute of expiring. */
  private async accessToken(conn: Connection): Promise<string> {
    const client = this.requireClient();
    if (conn.accessToken && conn.accessTokenExpiresAt && conn.accessTokenExpiresAt.getTime() > Date.now() + 60_000) {
      try {
        return this.cipher.decrypt(conn.accessToken);
      } catch {
        // fall through to a refresh
      }
    }
    const tokens = await client.refresh(this.cipher.decrypt(conn.refreshToken));
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
    await this.prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: {
        accessToken: this.cipher.encrypt(tokens.access_token),
        accessTokenExpiresAt: expiresAt,
        ...(tokens.refresh_token ? { refreshToken: this.cipher.encrypt(tokens.refresh_token) } : {}),
      },
    });
    conn.accessToken = this.cipher.encrypt(tokens.access_token);
    conn.accessTokenExpiresAt = expiresAt;
    return tokens.access_token;
  }

  private async workspaceTimeZone(orgId: string): Promise<string> {
    const settings = await this.prisma.systemSettings.findUnique({
      where: { organizationId: orgId },
      select: { timezone: true },
    });
    const tz: string | null | undefined = settings?.timezone;
    return tz && isValidTimeZone(tz) ? tz : "UTC";
  }

  /** Creates the portal's own calendar in Google, or a new one if the old one was deleted there. */
  private async ensurePortalCalendar(conn: Connection, token: string): Promise<string> {
    const client = this.requireClient();
    if (conn.portalCalendarId) {
      try {
        await client.getCalendar(token, conn.portalCalendarId);
        return conn.portalCalendarId;
      } catch (err) {
        if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
      }
    }
    const org = await this.prisma.organization.findUnique({ where: { id: conn.organizationId }, select: { name: true } });
    const created = await client.createCalendar(
      token,
      `${org?.name ?? "Client"} portal`,
      await this.workspaceTimeZone(conn.organizationId),
    );
    await this.prisma.googleCalendarPush.deleteMany({ where: { connectionId: conn.id } });
    await this.prisma.googleCalendarConnection.update({ where: { id: conn.id }, data: { portalCalendarId: created.id } });
    conn.portalCalendarId = created.id;
    return created.id;
  }

  /** Google -> portal: refreshes the cached events of the account's primary calendar. */
  private async pull(conn: Connection, token: string): Promise<void> {
    const client = this.requireClient();
    const full: boolean =
      !conn.syncToken || !conn.lastFullSyncAt || Date.now() - conn.lastFullSyncAt.getTime() > FULL_SYNC_EVERY_MS;

    const read = async (params: Record<string, string>): Promise<{ items: GoogleEvent[]; syncToken: string | null }> => {
      const items: GoogleEvent[] = [];
      let pageToken: string | undefined;
      let syncToken: string | null = null;
      do {
        const page = await client.listEvents(token, conn.readCalendarId, {
          ...params,
          ...(pageToken ? { pageToken } : {}),
        });
        items.push(...(page.items ?? []));
        pageToken = page.nextPageToken;
        syncToken = page.nextSyncToken ?? syncToken;
      } while (pageToken);
      return { items, syncToken };
    };

    const base = { singleEvents: "true", maxResults: "2500" };
    let mode: "full" | "incremental" = full ? "full" : "incremental";
    let result: { items: GoogleEvent[]; syncToken: string | null };
    try {
      result =
        mode === "full"
          ? await read({ ...base, ...this.pullWindow() })
          : await read({ ...base, syncToken: conn.syncToken as string });
    } catch (err) {
      // 410 Gone: the sync token expired. Start again with a full read.
      if (!(mode === "incremental" && err instanceof GoogleApiError && err.status === 410)) throw err;
      mode = "full";
      result = await read({ ...base, ...this.pullWindow() });
    }

    const seen: string[] = [];
    for (const g of result.items) {
      const fields: CachedEventFields | null = fromGoogleEvent(g);
      if (!fields) {
        if (mode === "incremental" && g.id) {
          await this.prisma.googleCalendarEvent.deleteMany({ where: { connectionId: conn.id, googleEventId: g.id } });
        }
        continue;
      }
      seen.push(fields.googleEventId);
      await this.upsertCached(conn, fields);
    }
    if (mode === "full") {
      await this.prisma.googleCalendarEvent.deleteMany({
        where: { connectionId: conn.id, googleEventId: { notIn: seen } },
      });
    }
    await this.prisma.googleCalendarConnection.update({
      where: { id: conn.id },
      data: { syncToken: result.syncToken, ...(mode === "full" ? { lastFullSyncAt: new Date() } : {}) },
    });
  }

  private pullWindow(): { timeMin: string; timeMax: string } {
    const now: number = Date.now();
    return {
      timeMin: new Date(now - PULL_PAST_DAYS * DAY_MS).toISOString(),
      timeMax: new Date(now + PULL_FUTURE_DAYS * DAY_MS).toISOString(),
    };
  }

  /** Portal -> Google: keeps the portal calendar in Google matching open portal deadlines. */
  private async push(conn: Connection, token: string): Promise<void> {
    const client = this.requireClient();
    const calendarId: string = await this.ensurePortalCalendar(conn, token);
    const tz: string = await this.workspaceTimeZone(conn.organizationId);
    const today: string = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const from: string = addDays(today, -PUSH_PAST_DAYS);
    const to: string = addDays(today, PUSH_FUTURE_DAYS);

    const items = (await this.calendar.list(conn.organizationId, { from, to, tz, type: PORTAL_TYPES })).filter(shouldPush);
    const pushed = await this.prisma.googleCalendarPush.findMany({ where: { connectionId: conn.id } });
    const byKey = new Map(pushed.map((p) => [p.sourceKey, p]));
    const sourceTitle = "Client portal";
    const webUrl: string = this.cfg?.webUrl ?? "";
    const wanted = new Set<string>();

    for (const item of items) {
      const key: string = sourceKey(item);
      wanted.add(key);
      const body: GoogleEventBody = toGoogleBody(item, webUrl, sourceTitle);
      const hash: string = bodyHash(body);
      const prev = byKey.get(key);
      if (prev && prev.hash === hash) continue;
      let googleEventId: string | null = null;
      if (prev) {
        try {
          googleEventId = (await client.patchEvent(token, calendarId, prev.googleEventId, body)).id;
        } catch (err) {
          if (!(err instanceof GoogleApiError && (err.status === 404 || err.status === 410))) throw err;
        }
      }
      if (!googleEventId) googleEventId = (await client.insertEvent(token, calendarId, body)).id;
      await this.prisma.googleCalendarPush.upsert({
        where: { connectionId_sourceKey: { connectionId: conn.id, sourceKey: key } },
        create: { connectionId: conn.id, sourceKey: key, googleEventId, date: item.date, hash },
        update: { googleEventId, date: item.date, hash },
      });
    }

    // Items that closed, moved out of the window's reach or were deleted.
    for (const p of pushed) {
      if (wanted.has(p.sourceKey)) continue;
      if (p.date < from) continue; // past items stay as a record
      await client.deleteEvent(token, calendarId, p.googleEventId);
      await this.prisma.googleCalendarPush.delete({ where: { id: p.id } });
    }
  }

  private async removePushed(conn: Connection, token: string): Promise<void> {
    if (!conn.portalCalendarId) return;
    const pushed = await this.prisma.googleCalendarPush.findMany({ where: { connectionId: conn.id } });
    for (const p of pushed) {
      await this.requireClient().deleteEvent(token, conn.portalCalendarId, p.googleEventId);
      await this.prisma.googleCalendarPush.delete({ where: { id: p.id } });
    }
  }

  private async upsertCached(conn: Connection, fields: CachedEventFields): Promise<CachedRow> {
    return this.prisma.googleCalendarEvent.upsert({
      where: { connectionId_googleEventId: { connectionId: conn.id, googleEventId: fields.googleEventId } },
      create: { ...fields, connectionId: conn.id, organizationId: conn.organizationId },
      update: fields,
    });
  }

  private async cache(conn: Connection, g: GoogleEvent): Promise<CalendarEvent[]> {
    const fields = fromGoogleEvent(g);
    if (!fields) return [];
    const row: CachedRow = await this.upsertCached(conn, fields);
    const tz: string = await this.workspaceTimeZone(conn.organizationId);
    return cachedRowToEvents(row, null, null, tz);
  }

  private async eventBody(orgId: string, dto: GoogleEventInputDto): Promise<GoogleEventBody> {
    const tz: string =
      dto.timeZone && isValidTimeZone(dto.timeZone) ? dto.timeZone : await this.workspaceTimeZone(orgId);
    const base = {
      summary: dto.title.trim(),
      ...(dto.description ? { description: dto.description } : {}),
      ...(dto.location ? { location: dto.location } : {}),
    };
    if (!dto.startTime) {
      return { ...base, start: { date: dto.date }, end: { date: addDays(dto.date, 1) } };
    }
    const endTime: string = dto.endTime ?? plusOneHour(dto.startTime);
    const endDate: string = endTime > dto.startTime ? dto.date : addDays(dto.date, 1);
    if (dto.endTime && dto.endTime <= dto.startTime) {
      throw new BadRequestException("The end time must be after the start time");
    }
    return {
      ...base,
      start: { dateTime: `${dto.date}T${dto.startTime}:00`, timeZone: tz },
      end: { dateTime: `${endDate}T${endTime}:00`, timeZone: tz },
    };
  }
}

/** "HH:MM" one hour later, wrapping past midnight. */
export function plusOneHour(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return `${String((h + 1) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

