import { describe, expect, it } from "bun:test";
import type { CalendarEvent } from "@atrium/shared";
import { GoogleCalendarService } from "./google-calendar.service";
import { StateSigner } from "./google-calendar.crypto";
import type { GoogleEvent } from "./google-calendar.client";

const SECRET = "s".repeat(40);
const ENV: Record<string, string> = {
  BETTER_AUTH_SECRET: SECRET,
  GOOGLE_CALENDAR_CLIENT_ID: "client-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "client-secret",
  API_URL: "https://portal.example.com",
  WEB_URL: "https://portal.example.com",
};

type Row = Record<string, unknown> & { id: string };
let seq = 0;
const nextId = (): string => `id${++seq}`;

/** Just enough Prisma for the service, kept in memory. */
function fakePrisma() {
  const conns: Row[] = [];
  const events: Row[] = [];
  const pushes: Row[] = [];
  const matches = (row: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && "notIn" in (v as object)) return !(v as { notIn: unknown[] }).notIn.includes(row[k]);
      if (v && typeof v === "object" && "in" in (v as object)) return (v as { in: unknown[] }).in.includes(row[k]);
      return row[k] === v;
    });
  const byUnique = (rows: Row[], where: Record<string, unknown>): Row | undefined => {
    const key = Object.keys(where)[0];
    const value = where[key];
    if (value && typeof value === "object") return rows.find((r) => matches(r, value as Record<string, unknown>));
    return rows.find((r) => r[key] === value);
  };
  const table = (rows: Row[]) => ({
    findUnique: async ({ where }: { where: Record<string, unknown> }) => byUnique(rows, where) ?? null,
    findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => !where || matches(r, where)),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: Row = { id: nextId(), pushEnabled: true, pullEnabled: true, readCalendarId: "primary", portalCalendarId: null, syncToken: null, lastFullSyncAt: null, ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = byUnique(rows, where);
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return row;
    },
    upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const row = byUnique(rows, where);
      if (row) return Object.assign(row, update);
      const created: Row = { id: nextId(), ...create };
      rows.push(created);
      return created;
    },
    delete: async ({ where }: { where: Record<string, unknown> }) => {
      const i = rows.findIndex((r) => r === byUnique(rows, where));
      if (i >= 0) {
        const [row] = rows.splice(i, 1);
        if (rows === conns) {
          for (const list of [events, pushes]) for (let j = list.length - 1; j >= 0; j--) if (list[j].connectionId === row.id) list.splice(j, 1);
        }
        return row;
      }
      throw new Error("not found");
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], where)) { rows.splice(i, 1); count++; }
      return { count };
    },
  });
  const prisma = {
    googleCalendarConnection: table(conns),
    googleCalendarEvent: table(events),
    googleCalendarPush: table(pushes),
    systemSettings: { findUnique: async () => ({ timezone: "America/New_York" }) },
    organization: { findUnique: async () => ({ name: "Shana Studios" }) },
    member: { findFirst: async ({ where }: { where: { userId: string } }) => (where.userId === "owner-1" ? { id: "m1" } : null) },
  };
  return { prisma, conns, events, pushes };
}

/** A pretend Google Calendar with a primary and any created calendars. */
function fakeGoogle() {
  const calendars = new Map<string, Map<string, GoogleEvent & Record<string, unknown>>>([["primary", new Map()]]);
  const calls: string[] = [];
  let eventSeq = 0;
  let syncSeq = 0;
  const json = (status: number, body: unknown): Response =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const u = new URL(url);
    calls.push(`${method} ${u.pathname}`);
    if (u.hostname === "oauth2.googleapis.com") {
      if (u.pathname === "/revoke") return json(200, {});
      return json(200, { access_token: "access", expires_in: 3600, refresh_token: "refresh" });
    }
    const path = u.pathname.replace("/calendar/v3", "");
    if (path === "/calendars/primary" && method === "GET") return json(200, { id: "shana@shanastudios.co" });
    if (path === "/calendars" && method === "POST") {
      const id = `portal-${calendars.size}@group.calendar.google.com`;
      calendars.set(id, new Map());
      return json(200, { id });
    }
    const m = path.match(/^\/calendars\/([^/]+)(?:\/events(?:\/([^/]+))?)?$/);
    if (!m) return json(404, { error: { message: "nope" } });
    const calId = decodeURIComponent(m[1]);
    const cal = calendars.get(calId);
    if (!cal) return json(404, { error: { message: "Not Found", errors: [{ reason: "notFound" }] } });
    const isEvents = path.includes("/events");
    if (!isEvents) {
      if (method === "DELETE") { calendars.delete(calId); return json(204, null); }
      return json(200, { id: calId });
    }
    const eventId = m[2] ? decodeURIComponent(m[2]) : undefined;
    if (method === "GET") return json(200, { items: [...cal.values()], nextSyncToken: `sync-${++syncSeq}` });
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as GoogleEvent;
      const ev = { ...body, id: `ev${++eventSeq}`, status: "confirmed" };
      cal.set(ev.id, ev);
      return json(200, ev);
    }
    if (!eventId || !cal.has(eventId)) return json(404, { error: { message: "Not Found" } });
    if (method === "PATCH") {
      const ev = { ...cal.get(eventId)!, ...(JSON.parse(String(init?.body)) as object) };
      cal.set(eventId, ev);
      return json(200, ev);
    }
    if (method === "DELETE") { cal.delete(eventId); return json(204, null); }
    return json(400, {});
  };
  return { calendars, calls, fetchFn };
}

function build(items: CalendarEvent[] = []) {
  const db = fakePrisma();
  const google = fakeGoogle();
  const calendar = { list: async () => items };
  const service = new GoogleCalendarService(db.prisma as never, calendar as never, { get: (k: string) => ENV[k] } as never);
  service.useFetch(google.fetchFn);
  return { ...db, google, service, items };
}

async function connect(ctx: ReturnType<typeof build>): Promise<string> {
  const state = new StateSigner(SECRET).sign("org-1", "owner-1");
  return ctx.service.handleCallback({ code: "code", state });
}

const task: CalendarEvent = {
  type: "task", id: "t1", date: "2026-12-04", title: "Logo drafts", status: "todo",
  projectId: "p1", projectName: "Galé", assigneeId: null, assigneeName: null,
};

describe("GoogleCalendarService", () => {
  it("reports itself as not configured without client values", async () => {
    const db = fakePrisma();
    const service = new GoogleCalendarService(db.prisma as never, { list: async () => [] } as never, {
      get: (k: string) => (k === "BETTER_AUTH_SECRET" ? SECRET : undefined),
    } as never);
    expect((await service.status("org-1")).configured).toBe(false);
    expect(() => service.connectUrl("org-1", { id: "owner-1" })).toThrow();
  });

  it("asks Google for offline access to calendars only", () => {
    const { service } = build();
    const url = new URL(service.connectUrl("org-1", { id: "owner-1", email: "shana@shanastudios.co" }));
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe("https://portal.example.com/api/google-calendar/callback");
    expect(url.searchParams.get("scope")).toContain("calendar.events");
    expect(url.searchParams.get("login_hint")).toBe("shana@shanastudios.co");
  });

  it("refuses a forged or foreign state", async () => {
    const ctx = build();
    expect(await ctx.service.handleCallback({ code: "c", state: "bogus" })).toContain("google=expired");
    const notOwner = new StateSigner(SECRET).sign("org-1", "someone-else");
    expect(await ctx.service.handleCallback({ code: "c", state: notOwner })).toContain("google=forbidden");
    expect(ctx.conns).toHaveLength(0);
  });

  it("connects, makes the portal calendar and stores tokens encrypted", async () => {
    const ctx = build();
    expect(await connect(ctx)).toBe("https://portal.example.com/dashboard/calendar?google=connected");
    expect(ctx.conns).toHaveLength(1);
    const conn = ctx.conns[0];
    expect(conn.googleEmail).toBe("shana@shanastudios.co");
    expect(String(conn.refreshToken)).not.toContain("refresh");
    expect(conn.portalCalendarId).toBe("portal-1@group.calendar.google.com");
    const status = await ctx.service.status("org-1");
    expect(status.connected).toBe(true);
  });

  it("writes open portal items to Google, updates moved ones and removes closed ones", async () => {
    const ctx = build([task]);
    await connect(ctx);
    await ctx.service.sync("org-1");
    const portalCal = ctx.google.calendars.get("portal-1@group.calendar.google.com")!;
    expect([...portalCal.values()].map((e) => e.summary)).toEqual(["Due: Logo drafts (Galé)"]);

    // Unchanged: nothing rewritten.
    const before = ctx.google.calls.filter((c) => c.startsWith("PATCH") || c.startsWith("POST")).length;
    await ctx.service.sync("org-1");
    expect(ctx.google.calls.filter((c) => c.startsWith("PATCH") || c.startsWith("POST")).length).toBe(before);

    // Moved: patched in place.
    ctx.items[0] = { ...task, date: "2026-12-08" };
    await ctx.service.sync("org-1");
    expect([...portalCal.values()][0].start).toEqual({ date: "2026-12-08" });
    expect(portalCal.size).toBe(1);

    // Done: removed from Google.
    ctx.items[0] = { ...task, date: "2026-12-08", status: "done" };
    await ctx.service.sync("org-1");
    expect(portalCal.size).toBe(0);
    expect(ctx.pushes).toHaveLength(0);
  });

  it("reads Google events into the portal, skipping its own", async () => {
    const ctx = build([task]);
    ctx.google.calendars.get("primary")!.set("g1", {
      id: "g1", status: "confirmed", summary: "Client call",
      start: { dateTime: "2026-12-03T15:00:00Z" }, end: { dateTime: "2026-12-03T16:00:00Z" },
    });
    await connect(ctx);
    await ctx.service.sync("org-1");
    expect(ctx.events.map((e) => e.title)).toEqual(["Client call"]);

    // Deleted in Google: gone from the portal on the next full read.
    ctx.google.calendars.get("primary")!.delete("g1");
    ctx.conns[0].lastFullSyncAt = new Date(0);
    await ctx.service.sync("org-1");
    expect(ctx.events).toHaveLength(0);
  });

  it("creates, edits and deletes Google events from the portal", async () => {
    const ctx = build();
    await connect(ctx);
    const [created] = await ctx.service.createEvent("org-1", {
      title: "Kickoff with Galé", date: "2026-12-10", startTime: "10:00", timeZone: "America/New_York",
    });
    expect(created.type).toBe("google_event");
    const primary = ctx.google.calendars.get("primary")!;
    const ev = [...primary.values()][0];
    expect(ev.start).toEqual({ dateTime: "2026-12-10T10:00:00", timeZone: "America/New_York" });
    expect(ev.end).toEqual({ dateTime: "2026-12-10T11:00:00", timeZone: "America/New_York" });

    await ctx.service.updateEvent("org-1", created.id, { title: "Kickoff (moved)", date: "2026-12-11" });
    expect([...primary.values()][0].summary).toBe("Kickoff (moved)");
    expect([...primary.values()][0].start).toEqual({ date: "2026-12-11" });

    await ctx.service.deleteEvent("org-1", created.id);
    expect(primary.size).toBe(0);
    expect(ctx.events).toHaveLength(0);
  });

  it("rejects an end time before the start", async () => {
    const ctx = build();
    await connect(ctx);
    await expect(
      ctx.service.createEvent("org-1", { title: "x", date: "2026-12-10", startTime: "10:00", endTime: "09:00" }),
    ).rejects.toThrow();
  });

  it("disconnecting removes the portal calendar and the stored account", async () => {
    const ctx = build([task]);
    await connect(ctx);
    await ctx.service.sync("org-1");
    await ctx.service.disconnect("org-1");
    expect(ctx.google.calendars.has("portal-1@group.calendar.google.com")).toBe(false);
    expect(ctx.conns).toHaveLength(0);
    expect(ctx.pushes).toHaveLength(0);
  });
});
