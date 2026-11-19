import { createHash } from "node:crypto";
import { env } from "../config.ts";
import { query } from "../db/client.ts";

// Replaces emails, phone numbers and configured names with stable tokens like [[PII_1a2b3c4d]]
// before text goes to any LLM; tokens are swapped back when text comes back to you or into tools.
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE_INTL = /\+\d{1,3}[\s-]?\d(?:[\s-]?\d){7,12}/g; // +91 98765 43210, +81-90-1234-5678
const PHONE_IN = /(?<![\w+-])\d{5}[\s-]?\d{5}(?![\w-])/g; // 98765 43210
const TOKEN = /\[\[PII_[0-9a-f]{8}\]\]/g;

const cache = new Map<string, string>(); // token -> value

function names(): RegExp | null {
  const list = env("OWNER_NAMES").split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length) return null;
  const esc = list.sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`\\b(?:${esc.join("|")})\\b`, "gi");
}

function tokenFor(value: string) {
  return `[[PII_${createHash("sha1").update(value.toLowerCase()).digest("hex").slice(0, 8)}]]`;
}

export async function mask(text: string): Promise<string> {
  if (!text) return text;
  const found = new Map<string, string>();
  const patterns = [EMAIL, PHONE_INTL, PHONE_IN, names()].filter(Boolean) as RegExp[];
  let out = text;
  for (const re of patterns) {
    out = out.replace(re, (m) => {
      const t = tokenFor(m);
      found.set(t, m);
      return t;
    });
  }
  for (const [token, value] of found) {
    if (cache.get(token) === value) continue;
    cache.set(token, value);
    await query("INSERT INTO pii_map (token, value) VALUES ($1, $2) ON CONFLICT DO NOTHING", [token, value]);
  }
  return out;
}

export async function unmask(text: string): Promise<string> {
  if (!text) return text;
  const tokens = [...new Set(text.match(TOKEN) ?? [])];
  const missing = tokens.filter((t) => !cache.has(t));
  if (missing.length) {
    for (const r of await query("SELECT token, value FROM pii_map WHERE token = ANY($1)", [missing])) cache.set(r.token, r.value);
  }
  return text.replace(TOKEN, (t) => cache.get(t) ?? t);
}

/** Unmask every string inside a tool's arguments. */
export async function unmaskDeep<T>(v: T): Promise<T> {
  if (typeof v === "string") return (await unmask(v)) as T;
  if (Array.isArray(v)) return (await Promise.all(v.map(unmaskDeep))) as T;
  if (v && typeof v === "object") {
    const o: any = {};
    for (const [k, x] of Object.entries(v)) o[k] = await unmaskDeep(x);
    return o;
  }
  return v;
}
