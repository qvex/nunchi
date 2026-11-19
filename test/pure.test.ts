import { test } from "node:test";
import assert from "node:assert/strict";
import { inQuietHours, startOfLocalDay, nowForPrompt } from "../src/time.ts";
import { nextOccurrence } from "../src/tasks/recurrence.ts";
import { chunks } from "../src/discord/bot.ts";

const ist = (s: string) => new Date(`${s}+05:30`);

test("quiet hours wrap midnight (23:00-07:00 IST)", () => {
  assert.equal(inQuietHours(ist("2026-11-19T22:59:00")), false);
  assert.equal(inQuietHours(ist("2026-11-19T23:00:00")), true);
  assert.equal(inQuietHours(ist("2026-11-20T03:00:00")), true);
  assert.equal(inQuietHours(ist("2026-11-20T07:00:00")), false);
  assert.equal(inQuietHours(ist("2026-11-20T12:00:00")), false);
});

test("start of local day is IST midnight", () => {
  assert.equal(startOfLocalDay(ist("2026-11-19T17:45:12")).toISOString(), ist("2026-11-19T00:00:00").toISOString());
  assert.equal(startOfLocalDay(ist("2026-11-20T01:10:00")).toISOString(), ist("2026-11-20T00:00:00").toISOString());
});

test("recurrence keeps local time and skips weekends", () => {
  const due = ist("2026-11-20T18:00:00"); // Friday
  const after = ist("2026-11-20T18:01:00");
  assert.equal(nextOccurrence(due, "daily", after)!.toISOString(), ist("2026-11-21T18:00:00").toISOString());
  assert.equal(nextOccurrence(due, "weekdays", after)!.toISOString(), ist("2026-11-23T18:00:00").toISOString()); // Monday
  assert.equal(nextOccurrence(due, "weekly", after)!.toISOString(), ist("2026-11-27T18:00:00").toISOString());
  assert.equal(nextOccurrence(due, "none", after), null);
  // A long-missed daily task jumps to the next future occurrence, not one day later.
  assert.equal(nextOccurrence(ist("2026-11-01T09:00:00"), "daily", after)!.toISOString(), ist("2026-11-21T09:00:00").toISOString());
});

test("prompt time includes weekday and offset", () => {
  assert.match(nowForPrompt(ist("2026-11-19T17:30:00")), /^Thursday, 2026-11-19 17:30 \(Asia\/Kolkata, UTC\+05:30\)$/);
});

test("discord chunks stay under the limit", () => {
  const parts = chunks("line\n".repeat(1000));
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 1900));
  assert.equal(parts.join("\n").replace(/\n+/g, "\n").trim(), "line\n".repeat(1000).trim());
});
