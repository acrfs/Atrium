"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Trash2, X } from "lucide-react";
import { apiFetch } from "@/lib/api";
import type { CalendarEvent } from "./types";
import { toISODate } from "./types";

type GoogleEvent = Extract<CalendarEvent, { type: "google_event" }>;

/** "HH:MM" in the viewer's timezone. */
function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Create or edit an event in the connected Google Calendar. `event` null
 * means a new event on `defaultDate`. Saves straight to Google.
 */
export function GoogleEventDialog({
  event,
  defaultDate,
  onClose,
  onSaved,
}: {
  event: GoogleEvent | null;
  defaultDate: string;
  onClose: () => void;
  onSaved: () => void;
}): React.ReactElement {
  const editing = event !== null;
  const [title, setTitle] = useState<string>(event?.title ?? "");
  const [date, setDate] = useState<string>(() => {
    if (!event) return defaultDate;
    return event.allDay ? (event.start.slice(0, 10)) : toISODate(new Date(event.start));
  });
  const [allDay, setAllDay] = useState<boolean>(event ? event.allDay : false);
  const [startTime, setStartTime] = useState<string>(event && !event.allDay ? hhmm(event.start) : "10:00");
  const [endTime, setEndTime] = useState<string>(event && !event.allDay ? hhmm(event.end) : "11:00");
  const [location, setLocation] = useState<string>(event?.location ?? "");
  const [description, setDescription] = useState<string>(event?.description ?? "");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        date,
        ...(allDay ? {} : { startTime, endTime }),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        location: location.trim() || undefined,
        description: description.trim() || undefined,
      };
      await apiFetch(editing ? `/google-calendar/events/${event.id}` : "/google-calendar/events", {
        method: editing ? "PATCH" : "POST",
        body: JSON.stringify(body),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the event");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (!event) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/google-calendar/events/${event.id}`, { method: "DELETE" });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the event");
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm outline-none focus:ring-1 focus:ring-[var(--primary)]";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="google-event-title"
        onSubmit={save}
        className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md mx-4 p-6 space-y-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="google-event-title" className="text-lg font-semibold">{editing ? "Edit event" : "New event"}</h3>
            <p className="text-xs text-[var(--muted-foreground)]">Saved to Google Calendar</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded hover:bg-[var(--muted)]"><X size={16} /></button>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={300} autoFocus className={input} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 col-span-2 sm:col-span-1">
            <span className="text-xs font-medium text-[var(--muted-foreground)]">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={input} />
          </label>
          <label className="flex items-center gap-2 text-sm self-end pb-2 col-span-2 sm:col-span-1">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="accent-[var(--primary)] w-3.5 h-3.5" />
            All day
          </label>
          {!allDay && (
            <>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Starts</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} required className={input} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-[var(--muted-foreground)]">Ends</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} required className={input} />
              </label>
            </>
          )}
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Location or link</span>
          <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className={input} />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-[var(--muted-foreground)]">Notes</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={5000} className={input} />
        </label>

        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {editing && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-600 hover:bg-red-600/10 disabled:opacity-40"
              ><Trash2 size={14} /> Delete</button>
            )}
            {editing && event.htmlLink && (
              <a
                href={event.htmlLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
              ><ExternalLink size={14} /> Open in Google</a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors">Cancel</button>
            <button type="submit" disabled={busy || !title.trim()} className="px-4 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 transition-colors disabled:opacity-40">
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
