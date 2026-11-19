import { createHash } from "node:crypto";
import { config, env } from "../config.ts";
import { genai } from "../llm/embed.ts";

export interface Listing {
  externalId: string;
  source: string;
  title: string;
  company?: string;
  location?: string;
  country: string; // ISO-2 lower case, or "eu"/"intl" when unknown
  url?: string;
  description?: string;
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 16);

async function getJson(url: string, init?: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`);
  return r.json() as Promise<any>;
}

/** Adzuna: India + EU countries. https://developer.adzuna.com/docs/search */
export async function adzuna(role: string): Promise<Listing[]> {
  const id = env("ADZUNA_APP_ID"), key = env("ADZUNA_APP_KEY");
  if (!id || !key) return [];
  const out: Listing[] = [];
  for (const c of config.jobs.adzunaCountries) {
    const u = new URL(`https://api.adzuna.com/v1/api/jobs/${c}/search/1`);
    Object.entries({ app_id: id, app_key: key, what: role, results_per_page: "15", max_days_old: "3" }).forEach(([k, v]) => u.searchParams.set(k, v));
    try {
      const data = await getJson(u.toString());
      for (const j of data.results ?? [])
        out.push({
          externalId: `adzuna:${j.id}`, source: "adzuna", title: j.title, company: j.company?.display_name,
          location: j.location?.display_name, country: c, url: j.redirect_url, description: j.description,
        });
    } catch (e) {
      console.warn(`[jobs] adzuna ${c}:`, (e as Error).message);
    }
  }
  return out;
}

const COUNTRY_NAMES: Record<string, string> = { kr: "South Korea", jp: "Japan" };

/** JSearch (RapidAPI): South Korea + Japan. */
export async function jsearch(role: string): Promise<Listing[]> {
  const key = env("JSEARCH_API_KEY");
  if (!key) return [];
  const out: Listing[] = [];
  for (const c of config.jobs.jsearchCountries) {
    const u = new URL("https://jsearch.p.rapidapi.com/search");
    u.searchParams.set("query", `${role} in ${COUNTRY_NAMES[c] ?? c}`);
    u.searchParams.set("country", c);
    u.searchParams.set("date_posted", "3days");
    u.searchParams.set("num_pages", "1");
    try {
      const data = await getJson(u.toString(), { headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": "jsearch.p.rapidapi.com" } });
      for (const j of data.data ?? [])
        out.push({
          externalId: `jsearch:${j.job_id}`, source: "jsearch", title: j.job_title, company: j.employer_name,
          location: [j.job_city, j.job_country].filter(Boolean).join(", "), country: (j.job_country ?? c).toLowerCase(),
          url: j.job_apply_link, description: j.job_description,
        });
    } catch (e) {
      console.warn(`[jobs] jsearch ${c}:`, (e as Error).message);
    }
  }
  return out;
}

/** Gemini with Google Search grounding: one call covering all roles and regions. */
export async function webSearch(roles: string[]): Promise<Listing[]> {
  if (!env("GOOGLE_API_KEY")) return [];
  const prompt = `Search the web for job postings published in the last 3 days for these roles: ${roles.join("; ")}.
Regions: India; European Union countries; South Korea; Japan.
Only include postings whose working language is English. For roles outside India, only include ones that mention visa sponsorship or relocation support.
Return ONLY a JSON array (no prose) of up to 20 objects: {"title","company","location","country_code" (ISO-2 lower case),"url" (the posting's own page),"summary" (2-3 sentences)}.
Use only postings you actually found; never invent URLs.`;
  try {
    const res = await genai().models.generateContent({
      model: config.jobs.searchModel,
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });
    const text = res.text ?? "";
    const json = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
    const items: any[] = json ? JSON.parse(json) : [];
    return items
      .filter((j) => j.title && j.url)
      .map((j) => ({
        externalId: `web:${hash(j.url)}`, source: "web", title: j.title, company: j.company, location: j.location,
        country: (j.country_code ?? "intl").toLowerCase(), url: j.url, description: j.summary,
      }));
  } catch (e) {
    console.warn("[jobs] web search:", (e as Error).message);
    return [];
  }
}
