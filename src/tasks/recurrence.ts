import { localParts } from "../time.ts";

export const RECURRENCES = ["none", "daily", "weekdays", "weekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

const DAY = 86_400_000;

/** Next occurrence strictly after `after` (default now), keeping the same local time of day. */
export function nextOccurrence(due: Date, rec: Recurrence, after = new Date()): Date | null {
  if (rec === "none") return null;
  let next = new Date(due);
  do {
    if (rec === "daily") next = new Date(next.getTime() + DAY);
    else if (rec === "weekly") next = new Date(next.getTime() + 7 * DAY);
    else if (rec === "weekdays") {
      do next = new Date(next.getTime() + DAY);
      while (["Sat", "Sun"].includes(localParts(next).weekday));
    } else if (rec === "monthly") {
      const n = new Date(next);
      n.setUTCMonth(n.getUTCMonth() + 1);
      next = n;
    }
  } while (next <= after);
  return next;
}
