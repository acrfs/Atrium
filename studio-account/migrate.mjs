// Copies mail and calendars from Shana's old Gmail account into her Shana
// Studios Google account. Copy only: the old account is never changed.
// Safe to run again: a message whose Message-ID is already in the new mailbox
// is skipped, and calendar events are imported by their iCalUID, which updates
// the earlier copy instead of adding a second one.

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const GMAIL_UPLOAD = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const CAL = "https://www.googleapis.com/calendar/v3";

// Gmail labels that the new mailbox understands and that are worth keeping.
const KEEP_SYSTEM = new Set([
  "INBOX", "SENT", "UNREAD", "STARRED", "IMPORTANT",
  "CATEGORY_PERSONAL", "CATEGORY_SOCIAL", "CATEGORY_PROMOTIONS", "CATEGORY_UPDATES", "CATEGORY_FORUMS",
]);

export function newProgress() {
  return {
    state: "idle", // idle | running | done | failed
    startedAt: null,
    finishedAt: null,
    mail: { total: 0, copied: 0, already: 0, skipped: 0, failed: 0 },
    calendar: { calendars: 0, others: 0, copied: 0, skipped: 0, failed: 0 },
    errors: [],
    message: "",
  };
}

function note(progress, text) {
  progress.errors.push(text);
  if (progress.errors.length > 25) progress.errors.splice(0, progress.errors.length - 25);
}

/** The Message-ID header from the top of a raw message, without the <>. */
export function messageIdOf(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  const headers = (end === -1 ? raw : raw.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  const m = headers.match(/^message-id:\s*<?([^>\s]+)>?/im);
  return m ? m[1] : null;
}

/** Which of a message's labels to put on the copy, as names for user labels. */
export function labelsForCopy(labelIds, sourceLabels) {
  const system = [];
  const user = [];
  for (const id of labelIds ?? []) {
    if (KEEP_SYSTEM.has(id)) system.push(id);
    else {
      const l = sourceLabels.get(id);
      if (l && l.type === "user") user.push(l.name);
    }
  }
  return { system, user };
}

const b64urlToBuffer = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function multipart(meta, rawBuf) {
  const boundary = `shana${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, rawBuf, tail]), type: `multipart/related; boundary=${boundary}` };
}

export async function copyMail(src, dst, progress, { concurrency = 4 } = {}) {
  const profile = await src.call("GET", `${GMAIL}/profile`);
  progress.mail.total = Number(profile.messagesTotal ?? 0);

  const sourceLabels = new Map();
  for (const l of (await src.call("GET", `${GMAIL}/labels`)).labels ?? []) sourceLabels.set(l.id, l);
  const targetByName = new Map();
  for (const l of (await dst.call("GET", `${GMAIL}/labels`)).labels ?? []) targetByName.set(l.name.toLowerCase(), l.id);

  // Parents first ("Clients" before "Clients/Acme"), so nested labels nest.
  async function targetLabel(name) {
    const key = name.toLowerCase();
    if (targetByName.has(key)) return targetByName.get(key);
    const parts = name.split("/");
    if (parts.length > 1) await targetLabel(parts.slice(0, -1).join("/"));
    try {
      const made = await dst.call("POST", `${GMAIL}/labels`, { json: { name, labelListVisibility: "labelShow", messageListVisibility: "show" } });
      targetByName.set(key, made.id);
      return made.id;
    } catch (err) {
      // Someone made it meanwhile, or the name is reserved: look again.
      const again = ((await dst.call("GET", `${GMAIL}/labels`)).labels ?? []).find((l) => l.name.toLowerCase() === key);
      if (again) {
        targetByName.set(key, again.id);
        return again.id;
      }
      throw err;
    }
  }

  async function copyOne(id) {
    try {
      const msg = await src.call("GET", `${GMAIL}/messages/${id}?format=raw`);
      const labelIds = msg.labelIds ?? [];
      if (labelIds.includes("DRAFT") || labelIds.includes("CHAT")) {
        progress.mail.skipped++;
        return;
      }
      const rawBuf = b64urlToBuffer(msg.raw);
      const mid = messageIdOf(rawBuf.subarray(0, 64 * 1024).toString("latin1"));
      if (mid) {
        const q = new URLSearchParams({ q: `rfc822msgid:${mid}`, includeSpamTrash: "true", maxResults: "1" });
        const found = await dst.call("GET", `${GMAIL}/messages?${q}`);
        if ((found.messages ?? []).length) {
          progress.mail.already++;
          return;
        }
      }
      const { system, user } = labelsForCopy(labelIds, sourceLabels);
      const ids = [...system];
      for (const name of user) ids.push(await targetLabel(name));
      const { body, type } = multipart({ labelIds: ids }, rawBuf);
      const q = new URLSearchParams({ uploadType: "multipart", internalDateSource: "dateHeader", neverMarkSpam: "true", processForCalendar: "false" });
      await dst.call("POST", `${GMAIL_UPLOAD}/messages/import?${q}`, { body, headers: { "content-type": type } });
      progress.mail.copied++;
    } catch (err) {
      progress.mail.failed++;
      note(progress, `Email ${id}: ${err.message}`);
    }
  }

  let pageToken;
  do {
    const q = new URLSearchParams({ maxResults: "500", includeSpamTrash: "false" });
    if (pageToken) q.set("pageToken", pageToken);
    const page = await src.call("GET", `${GMAIL}/messages?${q}`);
    const ids = (page.messages ?? []).map((m) => m.id);
    for (let i = 0; i < ids.length; i += concurrency) {
      await Promise.all(ids.slice(i, i + concurrency).map(copyOne));
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
}

/** An EXDATE line for one cancelled occurrence of a repeating event. */
export function exdateFor(originalStartTime) {
  if (originalStartTime?.date) return `EXDATE;VALUE=DATE:${originalStartTime.date.replace(/-/g, "")}`;
  if (originalStartTime?.dateTime) {
    const d = new Date(originalStartTime.dateTime);
    if (!Number.isNaN(d.getTime())) return `EXDATE:${d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")}`;
  }
  return null;
}

const EVENT_FIELDS = [
  "summary", "description", "location", "colorId", "start", "end", "endTimeUnspecified", "recurrence",
  "originalStartTime", "transparency", "visibility", "iCalUID", "sequence", "attendees", "attendeesOmitted",
  "extendedProperties", "guestsCanInviteOthers", "guestsCanModify", "guestsCanSeeOtherGuests", "organizer",
  "reminders", "source", "status", "eventType",
];

/** The parts of an old event that the import call takes. */
export function eventForImport(ev, extraExdates = []) {
  const out = {};
  for (const k of EVENT_FIELDS) if (ev[k] !== undefined) out[k] = ev[k];
  if (out.attendees) out.attendees = out.attendees.map(({ id, self, ...a }) => a);
  if (out.organizer) {
    const { id, self, ...o } = out.organizer;
    out.organizer = o;
  }
  if (ev.conferenceData?.entryPoints) {
    const { createRequest, ...c } = ev.conferenceData;
    out.conferenceData = c;
  }
  if (extraExdates.length) out.recurrence = [...(out.recurrence ?? []), ...extraExdates];
  return out;
}

async function listAll(client, url, key = "items") {
  const items = [];
  let pageToken;
  do {
    const u = new URL(url);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const page = await client.call("GET", u.toString());
    items.push(...(page[key] ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

export async function copyCalendars(src, dst, progress) {
  const all = await listAll(src, `${CAL}/users/me/calendarList?maxResults=250`);
  // Only her own calendars. Holidays, birthdays and calendars other people
  // share with her stay where they are (she can subscribe again by name).
  const own = all.filter((c) => c.accessRole === "owner");
  const theirs = await listAll(dst, `${CAL}/users/me/calendarList?maxResults=250`);

  for (const cal of own) {
    let targetId = "primary";
    if (!cal.primary) {
      const name = cal.summaryOverride ?? cal.summary;
      const match = theirs.find((c) => c.accessRole === "owner" && !c.primary && (c.summaryOverride ?? c.summary) === name);
      if (match) targetId = match.id;
      else {
        const made = await dst.call("POST", `${CAL}/calendars`, {
          json: { summary: name, description: cal.description, timeZone: cal.timeZone },
        });
        targetId = made.id;
        theirs.push({ ...made, accessRole: "owner" });
      }
    }
    progress.calendar.calendars++;

    const events = await listAll(
      src,
      `${CAL}/calendars/${encodeURIComponent(cal.id)}/events?showDeleted=true&singleEvents=false&maxResults=2500`,
    );
    // A cancelled occurrence of a repeating event becomes an EXDATE on the series.
    const exdates = new Map();
    for (const ev of events) {
      if (ev.status === "cancelled" && ev.recurringEventId) {
        const line = exdateFor(ev.originalStartTime);
        if (line) exdates.set(ev.recurringEventId, [...(exdates.get(ev.recurringEventId) ?? []), line]);
      }
    }
    const series = events.filter((e) => e.status !== "cancelled" && !e.recurringEventId);
    const changedOnce = events.filter((e) => e.status !== "cancelled" && e.recurringEventId);
    for (const ev of [...series, ...changedOnce]) {
      if ((ev.eventType ?? "default") !== "default" || !ev.iCalUID) {
        progress.calendar.skipped++;
        continue;
      }
      try {
        await dst.call(
          "POST",
          `${CAL}/calendars/${encodeURIComponent(targetId)}/events/import?conferenceDataVersion=1&supportsAttachments=false`,
          { json: eventForImport(ev, exdates.get(ev.id) ?? []) },
        );
        progress.calendar.copied++;
      } catch (err) {
        progress.calendar.failed++;
        note(progress, `Event "${ev.summary ?? "(no title)"}": ${err.message}`);
      }
    }
  }
  progress.calendar.others = all.length - own.length;
}

export async function runMigration(src, dst, progress, { mail = true, calendar = true } = {}) {
  Object.assign(progress, newProgress(), { state: "running", startedAt: new Date().toISOString() });
  try {
    if (calendar) {
      progress.message = "Copying calendars";
      await copyCalendars(src, dst, progress);
    }
    if (mail) {
      progress.message = "Copying email";
      await copyMail(src, dst, progress);
    }
    progress.state = "done";
    progress.message = "Finished";
  } catch (err) {
    progress.state = "failed";
    progress.message = err.message;
  } finally {
    progress.finishedAt = new Date().toISOString();
  }
  return progress;
}
