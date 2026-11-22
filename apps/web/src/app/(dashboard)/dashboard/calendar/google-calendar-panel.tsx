"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { GoogleCalendarStatus } from "@atrium/shared";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Toolbar button + popover that connects, syncs and controls the Google Calendar link. */
export function GoogleCalendarPanel({
  status,
  onChange,
}: {
  status: GoogleCalendarStatus | null;
  onChange: (next: GoogleCalendarStatus | null) => void;
}): React.ReactElement | null {
  const [open, setOpen] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!status) return null;

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function connect(): Promise<void> {
    const res = await run(() => apiFetch<{ url: string }>("/google-calendar/connect", { method: "POST" }));
    if (res?.url) window.location.href = res.url;
  }

  async function syncNow(): Promise<void> {
    const next = await run(() => apiFetch<GoogleCalendarStatus>("/google-calendar/sync", { method: "POST" }));
    if (next) onChange(next);
  }

  async function toggle(field: "pushEnabled" | "pullEnabled", value: boolean): Promise<void> {
    const next = await run(() =>
      apiFetch<GoogleCalendarStatus>("/google-calendar/settings", { method: "PATCH", body: JSON.stringify({ [field]: value }) }),
    );
    if (next) onChange(next);
  }

  async function disconnect(): Promise<void> {
    const ok = await confirm({
      title: "Disconnect Google Calendar?",
      message: "The portal's calendar is removed from Google and Google events stop showing here. Events in your own Google calendars stay as they are.",
      confirmLabel: "Disconnect",
      variant: "danger",
    });
    if (!ok) return;
    await run(() => apiFetch("/google-calendar", { method: "DELETE" }));
    onChange({ ...status!, connected: false, googleEmail: null, portalCalendarId: null, lastSyncedAt: null, lastError: null });
  }

  const dot = !status.connected ? "bg-[var(--muted-foreground)]" : status.lastError ? "bg-red-500" : "bg-emerald-500";

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="h-7 px-2.5 inline-flex items-center gap-1.5 text-xs rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
      >
        <CalendarDays size={12} />
        Google Calendar
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden="true" />
      </button>
      {open && (
        <div role="dialog" aria-label="Google Calendar" className="absolute z-30 right-0 top-full mt-1.5 w-72 rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg p-3 space-y-3 text-sm">
          {!status.configured ? (
            <p className="text-[var(--muted-foreground)]">
              Google Calendar isn&apos;t set up on this server yet. It needs a Google OAuth client
              (GOOGLE_CALENDAR_CLIENT_ID and GOOGLE_CALENDAR_CLIENT_SECRET).
            </p>
          ) : !status.connected ? (
            <>
              <p className="text-[var(--muted-foreground)]">
                Connect a Google account to see its events here and to put portal deadlines, project dates and invoice due dates in Google Calendar.
              </p>
              <button
                onClick={connect}
                disabled={busy}
                className="w-full px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40"
              >Connect Google Calendar</button>
            </>
          ) : (
            <>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Connected</div>
                <div className="font-medium truncate">{status.googleEmail}</div>
                <div className="text-xs text-[var(--muted-foreground)]">Last synced {ago(status.lastSyncedAt)}</div>
              </div>
              {status.lastError && <p role="alert" className="text-xs text-red-600">{status.lastError}</p>}
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={status.pullEnabled}
                  disabled={busy}
                  onChange={(e) => toggle("pullEnabled", e.target.checked)}
                  className="accent-[var(--primary)] w-3.5 h-3.5 mt-0.5"
                />
                <span>Show Google events here</span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={status.pushEnabled}
                  disabled={busy}
                  onChange={(e) => toggle("pushEnabled", e.target.checked)}
                  className="accent-[var(--primary)] w-3.5 h-3.5 mt-0.5"
                />
                <span>Put portal deadlines in Google Calendar <span className="block text-xs text-[var(--muted-foreground)]">On a separate &quot;portal&quot; calendar you can hide or recolor in Google</span></span>
              </label>
              <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
                <button
                  onClick={syncNow}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-[var(--border)] text-xs hover:bg-[var(--muted)] disabled:opacity-40"
                ><RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Sync now</button>
                <button
                  onClick={disconnect}
                  disabled={busy}
                  className="ml-auto px-2.5 py-1 rounded-md text-xs text-red-600 hover:bg-red-600/10 disabled:opacity-40"
                >Disconnect</button>
              </div>
            </>
          )}
          {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
