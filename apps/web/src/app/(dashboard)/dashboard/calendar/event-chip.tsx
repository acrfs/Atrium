"use client";

import Link from "next/link";
import { createContext, useContext } from "react";
import { CheckSquare, PlayCircle, StopCircle, Receipt, CalendarDays } from "lucide-react";
import { TASK_STATUSES } from "@atrium/shared";
import type { CalendarEvent, CalendarEventType } from "./types";

type GoogleEvent = Extract<CalendarEvent, { type: "google_event" }>;

/** Lets the calendar page open its edit dialog when a Google event chip is clicked. */
export const GoogleEventOpenContext = createContext<((event: GoogleEvent) => void) | null>(null);

/** "10:30 AM" in the viewer's timezone. */
export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function chipHref(e: CalendarEvent): string {
  if (e.type === "task") return `/dashboard/projects/${e.projectId}?tab=tasks&task=${e.id}`;
  if (e.type === "project_start" || e.type === "project_end") return `/dashboard/projects/${e.projectId}`;
  if (e.type === "invoice_due" && e.projectId) return `/dashboard/projects/${e.projectId}?tab=invoices`;
  return "#";
}

const STRIPE: Record<CalendarEventType, string> = {
  task: "border-l-blue-500 bg-blue-500/8",
  project_start: "border-l-emerald-500 bg-emerald-500/8",
  project_end: "border-l-violet-500 bg-violet-500/8",
  invoice_due: "border-l-amber-500 bg-amber-500/8",
  google_event: "border-l-pink-400 bg-pink-400/10",
};

const ICON_COLOR: Record<CalendarEventType, string> = {
  task: "text-blue-600 dark:text-blue-400",
  project_start: "text-emerald-600 dark:text-emerald-400",
  project_end: "text-violet-600 dark:text-violet-400",
  invoice_due: "text-amber-600 dark:text-amber-400",
  google_event: "text-pink-600 dark:text-pink-400",
};

export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const openGoogle = useContext(GoogleEventOpenContext);
  let icon: React.ReactNode;
  let label: string;
  let tooltip: string;
  let muted = false;

  if (event.type === "task") {
    icon = <CheckSquare size={11} />;
    label = event.title;
    tooltip = `${event.title} · ${event.projectName}${event.assigneeName ? ` · ${event.assigneeName}` : ""}`;
    muted = event.status === TASK_STATUSES.DONE;
  } else if (event.type === "project_start") {
    icon = <PlayCircle size={11} />;
    label = `Start: ${event.title}`;
    tooltip = `Project starts: ${event.title}`;
  } else if (event.type === "project_end") {
    icon = <StopCircle size={11} />;
    label = `End: ${event.title}`;
    tooltip = `Project ends: ${event.title}`;
  } else if (event.type === "invoice_due") {
    icon = <Receipt size={11} />;
    label = event.title;
    tooltip = `Invoice ${event.title} due${event.projectName ? ` · ${event.projectName}` : ""}`;
    muted = event.status === "paid";
  } else if (event.type === "google_event") {
    icon = <CalendarDays size={11} />;
    label = event.allDay ? event.title : `${timeLabel(event.start)} ${event.title}`;
    tooltip = [
      event.title,
      event.allDay ? "All day" : `${timeLabel(event.start)} to ${timeLabel(event.end)}`,
      event.location,
      "Google Calendar",
    ].filter(Boolean).join(" · ");
  } else {
    icon = null;
    label = "";
    tooltip = "";
  }

  const stripe = STRIPE[event.type];
  const iconColor = ICON_COLOR[event.type];

  const className = `flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-sm border-l-[3px] text-[11px] leading-tight truncate transition-all hover:brightness-95 dark:hover:brightness-110 ${stripe} ${compact ? "" : "w-full"} ${muted ? "opacity-50" : ""}`;

  if (event.type === "google_event") {
    const inner = (
      <>
        <span className={`shrink-0 ${iconColor}`}>{icon}</span>
        <span className="truncate text-[var(--foreground)]">{label}</span>
      </>
    );
    if (openGoogle) {
      return (
        <button type="button" onClick={() => openGoogle(event)} title={tooltip} className={`${className} text-left`}>
          {inner}
        </button>
      );
    }
    return (
      <a href={event.htmlLink ?? "#"} target="_blank" rel="noreferrer" title={tooltip} className={className}>
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={chipHref(event)}
      title={tooltip}
      className={className}
    >
      <span className={`shrink-0 ${iconColor}`}>{icon}</span>
      <span className={`truncate text-[var(--foreground)] ${muted ? "line-through" : ""}`}>{label}</span>
    </Link>
  );
}
