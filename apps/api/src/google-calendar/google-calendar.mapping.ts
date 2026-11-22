import { createHash } from "crypto";
import type { CalendarEvent } from "@atrium/shared";
import type { GoogleEvent, GoogleEventBody } from "./google-calendar.client";

/** Marks events the portal wrote, so they are never read back in as Google events. */
export const PORTAL_KEY_PROPERTY = "atriumKey";

export type PortalItem = Exclude<CalendarEvent, { type: "google_event" }>;

const CLOSED_TASK_STATUSES = new Set(["done", "cancelled"]);
const OPEN_INVOICE_STATUSES = new Set(["sent", "overdue"]);

/** The key a portal item is tracked by in Google: "<type>:<id>". */
export function sourceKey(e: PortalItem): string {
  return `${e.type}:${e.id}`;
}

/**
 * Whether a portal item belongs in Google Calendar: open tasks, project dates
 * and invoices that are out with the client. Finished tasks and paid or draft
 * invoices drop off, so the calendar only holds what still needs attention.
 */
export function shouldPush(e: CalendarEvent): e is PortalItem {
  if (e.type === "google_event") return false;
  if (e.type === "task") return !CLOSED_TASK_STATUSES.has(e.status);
  if (e.type === "invoice_due") return OPEN_INVOICE_STATUSES.has(e.status);
  return true;
}

/** YYYY-MM-DD plus `days`, on the calendar (no timezone involved). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function portalLink(webUrl: string, e: PortalItem): string {
  if (e.type === "task") return `${webUrl}/dashboard/projects/${e.projectId}?tab=tasks&task=${e.id}`;
  if (e.type === "invoice_due") {
    return e.projectId ? `${webUrl}/dashboard/projects/${e.projectId}?tab=invoices` : `${webUrl}/dashboard/calendar`;
  }
  return `${webUrl}/dashboard/projects/${e.projectId}`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function summaryOf(e: PortalItem): string {
  if (e.type === "task") return `Due: ${e.title} (${e.projectName})`;
  if (e.type === "invoice_due") {
    return `Invoice ${e.title} due${e.projectName ? ` (${e.projectName})` : ""} · ${formatCents(e.amountCents)}`;
  }
  return e.type === "project_start" ? `Project starts: ${e.title}` : `Project deadline: ${e.title}`;
}

/** The all-day Google event for a portal item. */
export function toGoogleBody(e: PortalItem, webUrl: string, sourceTitle: string): GoogleEventBody {
  const link: string = portalLink(webUrl, e);
  const lines: string[] = [];
  if (e.type === "task" && e.assigneeName) lines.push(`Assigned to ${e.assigneeName}`);
  if (e.type === "invoice_due") lines.push(`Status: ${e.status}`);
  lines.push(`Open in the portal: ${link}`);
  lines.push("", "Added by the client portal. Edits made here are replaced on the next sync.");
  return {
    summary: summaryOf(e),
    description: lines.join("\n"),
    start: { date: e.date },
    end: { date: addDays(e.date, 1) },
    // Deadlines are reminders, not meetings: keep the time free for scheduling.
    transparency: "transparent",
    source: { title: sourceTitle, url: link },
    extendedProperties: { private: { [PORTAL_KEY_PROPERTY]: sourceKey(e) } },
  };
}

/** Stable fingerprint of an event body, so unchanged items are not rewritten. */
export function bodyHash(body: GoogleEventBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 32);
}

/** The cached fields of a Google event. */
export interface CachedEventFields {
  googleEventId: string;
  title: string;
  description: string | null;
  location: string | null;
  htmlLink: string | null;
  start: Date;
  end: Date;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
}

/** The cached row for a Google event, or null for events the portal should not show. */
export function fromGoogleEvent(g: GoogleEvent): CachedEventFields | null {
  if (!g.id || g.status === "cancelled") return null;
  if (g.extendedProperties?.private?.[PORTAL_KEY_PROPERTY]) return null;
  const startDate: string | undefined = g.start?.date;
  let start: Date;
  let end: Date;
  let endDate: string | null = null;
  if (startDate) {
    endDate = g.end?.date ?? addDays(startDate, 1);
    start = new Date(`${startDate}T00:00:00.000Z`);
    end = new Date(`${endDate}T00:00:00.000Z`);
  } else if (g.start?.dateTime) {
    start = new Date(g.start.dateTime);
    end = g.end?.dateTime ? new Date(g.end.dateTime) : start;
  } else {
    return null;
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return {
    googleEventId: g.id,
    title: g.summary?.trim() || "(No title)",
    description: g.description ?? null,
    location: g.location ?? null,
    htmlLink: g.htmlLink ?? null,
    start,
    end,
    allDay: !!startDate,
    startDate: startDate ?? null,
    endDate,
  };
}

/** Calendar dates an all-day event covers, from `startDate` up to (not including) `endDate`. */
export function allDayDates(startDate: string, endDate: string, limit = 62): string[] {
  const out: string[] = [];
  for (let d = startDate; d < endDate && out.length < limit; d = addDays(d, 1)) out.push(d);
  return out.length > 0 ? out : [startDate];
}
