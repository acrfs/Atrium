import type { CalendarEvent } from "@atrium/shared";
import { allDayDates } from "./google-calendar.mapping";

/** The columns of a cached Google event the portal calendar reads. */
export interface CachedRow {
  id: string;
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

type GoogleCalendarEvent = Extract<CalendarEvent, { type: "google_event" }>;

/**
 * The portal calendar entries for a cached Google event: one per day an
 * all-day event covers, or one on the day a timed event starts (in `tz`).
 * `from`/`to` (YYYY-MM-DD, inclusive) trim multi-day events to the window.
 */
export function cachedRowToEvents(row: CachedRow, from: string | null, to: string | null, tz: string): GoogleCalendarEvent[] {
  const base = {
    type: "google_event" as const,
    id: row.id,
    title: row.title,
    projectId: null,
    allDay: row.allDay,
    start: row.start.toISOString(),
    end: row.end.toISOString(),
    location: row.location,
    htmlLink: row.htmlLink,
    description: row.description,
  };
  let dates: string[];
  if (row.allDay && row.startDate) {
    dates = allDayDates(row.startDate, row.endDate ?? row.startDate);
  } else {
    dates = [dateKey(row.start, tz)];
  }
  return dates
    .filter((d) => (from === null || d >= from) && (to === null || d <= to))
    .map((date) => ({ ...base, date }));
}

function dateKey(d: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}
