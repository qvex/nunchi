import { config } from "./config.ts";

const tz = () => config.timezone;

/** e.g. "Thursday, 2026-11-19 17:30 (Asia/Kolkata, UTC+05:30)" for prompts. */
export function nowForPrompt(d = new Date()): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz(), weekday: "long", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZoneName: "longOffset",
  }).formatToParts(d);
  const p = Object.fromEntries(f.map((x) => [x.type, x.value]));
  return `${p.weekday}, ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} (${tz()}, ${p.timeZoneName.replace("GMT", "UTC")})`;
}

/** Local wall-clock parts in the configured timezone. */
export function localParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz(), year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", weekday: "short", hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(f.map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, weekday: p.weekday };
}

export function formatLocal(d: Date | string | null): string {
  if (!d) return "no due time";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(d));
}

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

export function inQuietHours(d = new Date(), q = config.quietHours): boolean {
  const { h, mi } = localParts(d);
  const now = h * 60 + mi, s = minutes(q.start), e = minutes(q.end);
  return s <= e ? now >= s && now < e : now >= s || now < e; // window may wrap midnight
}

/** Start of the local day containing `d`, as a Date. */
export function startOfLocalDay(d = new Date()): Date {
  const { h, mi } = localParts(d);
  const s = new Date(d.getTime() - (h * 60 + mi) * 60_000);
  s.setUTCSeconds(0, 0);
  return s;
}
