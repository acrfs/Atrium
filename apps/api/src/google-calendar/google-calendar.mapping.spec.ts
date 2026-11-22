import { describe, expect, it } from "bun:test";
import type { CalendarEvent } from "@atrium/shared";
import { StateSigner, TokenCipher } from "./google-calendar.crypto";
import { addDays, allDayDates, bodyHash, fromGoogleEvent, shouldPush, toGoogleBody, PORTAL_KEY_PROPERTY } from "./google-calendar.mapping";
import { cachedRowToEvents } from "./google-calendar.events";
import { loadGoogleCalendarConfig } from "./google-calendar.config";
import { plusOneHour } from "./google-calendar.service";

const SECRET = "x".repeat(40);

describe("google calendar config", () => {
  it("is off until both client values are set", () => {
    expect(loadGoogleCalendarConfig({ get: () => undefined })).toBeNull();
    expect(loadGoogleCalendarConfig({ get: (k) => (k === "GOOGLE_CALENDAR_CLIENT_ID" ? "id" : undefined) })).toBeNull();
  });

  it("points the redirect at the public API URL", () => {
    const env: Record<string, string> = {
      GOOGLE_CALENDAR_CLIENT_ID: "id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
      API_URL: "https://portal.example.com/",
      WEB_URL: "https://portal.example.com",
    };
    const cfg = loadGoogleCalendarConfig({ get: (k) => env[k] });
    expect(cfg?.redirectUri).toBe("https://portal.example.com/api/google-calendar/callback");
  });
});

describe("token cipher and OAuth state", () => {
  it("round-trips tokens and rejects another key", () => {
    const a = new TokenCipher(SECRET);
    const enc = a.encrypt("refresh-token");
    expect(enc).not.toContain("refresh-token");
    expect(a.decrypt(enc)).toBe("refresh-token");
    expect(() => new TokenCipher("y".repeat(40)).decrypt(enc)).toThrow();
  });

  it("accepts its own fresh state only", () => {
    const signer = new StateSigner(SECRET);
    const now = 1_700_000_000_000;
    const state = signer.sign("org-1", "user-1", now);
    expect(signer.verify(state, now + 1000)).toEqual(expect.objectContaining({ o: "org-1", u: "user-1" }));
    expect(signer.verify(state, now + 11 * 60_000)).toBeNull();
    expect(signer.verify(`${state}x`, now)).toBeNull();
    expect(new StateSigner("z".repeat(40)).verify(state, now)).toBeNull();
    const [body] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ o: "org-2", u: "user-1", e: now + 60_000, n: "a" })).toString("base64url");
    expect(signer.verify(`${forged}.${state.split(".")[1]}`, now)).toBeNull();
    expect(body.length).toBeGreaterThan(0);
  });
});

const task: CalendarEvent = {
  type: "task", id: "t1", date: "2026-12-04", title: "Logo drafts", status: "todo",
  projectId: "p1", projectName: "Galé", assigneeId: null, assigneeName: null,
};
const invoice: CalendarEvent = {
  type: "invoice_due", id: "i1", date: "2026-12-31", title: "INV-0007", status: "sent",
  projectId: "p1", projectName: "Galé", amountCents: 125000,
};

describe("portal items written to Google", () => {
  it("only writes what is still open", () => {
    expect(shouldPush(task)).toBe(true);
    expect(shouldPush({ ...task, status: "done" })).toBe(false);
    expect(shouldPush(invoice)).toBe(true);
    expect(shouldPush({ ...invoice, status: "paid" })).toBe(false);
    expect(shouldPush({ ...invoice, status: "draft" })).toBe(false);
  });

  it("makes all-day, free-time events tagged with the portal key", () => {
    const body = toGoogleBody(invoice as Exclude<CalendarEvent, { type: "google_event" }>, "https://portal.example.com", "Client portal");
    expect(body.summary).toBe("Invoice INV-0007 due (Galé) · $1,250.00");
    expect(body.start).toEqual({ date: "2026-12-31" });
    expect(body.end).toEqual({ date: "2027-01-01" });
    expect(body.transparency).toBe("transparent");
    expect(body.extendedProperties?.private[PORTAL_KEY_PROPERTY]).toBe("invoice_due:i1");
    expect(body.source?.url).toBe("https://portal.example.com/dashboard/projects/p1?tab=invoices");
  });

  it("changes its hash only when the event changes", () => {
    const t = task as Exclude<CalendarEvent, { type: "google_event" }>;
    const a = bodyHash(toGoogleBody(t, "https://p", "s"));
    expect(bodyHash(toGoogleBody(t, "https://p", "s"))).toBe(a);
    expect(bodyHash(toGoogleBody({ ...t, date: "2026-12-05" } as typeof t, "https://p", "s"))).not.toBe(a);
  });
});

describe("Google events read into the portal", () => {
  it("skips cancelled events and the portal's own events", () => {
    expect(fromGoogleEvent({ id: "a", status: "cancelled" })).toBeNull();
    expect(
      fromGoogleEvent({
        id: "b", start: { date: "2026-12-01" }, end: { date: "2026-12-02" },
        extendedProperties: { private: { [PORTAL_KEY_PROPERTY]: "task:t1" } },
      }),
    ).toBeNull();
  });

  it("keeps all-day dates and spreads them over each day", () => {
    const f = fromGoogleEvent({ id: "c", summary: "Trip", start: { date: "2026-12-30" }, end: { date: "2027-01-02" } });
    expect(f?.allDay).toBe(true);
    expect(allDayDates(f!.startDate!, f!.endDate!)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
    const rows = cachedRowToEvents({ ...f!, id: "row" }, "2026-12-31", "2027-01-31", "America/New_York");
    expect(rows.map((r) => r.date)).toEqual(["2026-12-31", "2027-01-01"]);
  });

  it("places a timed event on its local day", () => {
    const f = fromGoogleEvent({
      id: "d", summary: "Client call",
      start: { dateTime: "2026-12-04T02:30:00Z" }, end: { dateTime: "2026-12-04T03:30:00Z" },
    });
    expect(f?.allDay).toBe(false);
    expect(cachedRowToEvents({ ...f!, id: "row" }, null, null, "America/New_York")[0].date).toBe("2026-12-03");
    expect(cachedRowToEvents({ ...f!, id: "row" }, null, null, "UTC")[0].date).toBe("2026-12-04");
  });

  it("names untitled events", () => {
    expect(fromGoogleEvent({ id: "e", start: { date: "2026-12-01" } })?.title).toBe("(No title)");
  });
});

describe("date helpers", () => {
  it("adds days across months and years", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("adds an hour to a time", () => {
    expect(plusOneHour("09:30")).toBe("10:30");
    expect(plusOneHour("23:15")).toBe("00:15");
  });
});
