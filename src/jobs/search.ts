import { z } from "zod";
import { config } from "../config.ts";
import { query } from "../db/client.ts";
import { mask } from "../llm/mask.ts";
import { withFallback } from "../llm/registry.ts";
import { adzuna, jsearch, webSearch, type Listing } from "./sources.ts";

export async function getProfile() {
  await query("INSERT INTO profile (id) VALUES (1) ON CONFLICT DO NOTHING");
  const [p] = await query("SELECT * FROM profile WHERE id = 1");
  return p as { resume_text: string | null; target_roles: string[]; roles_confirmed: boolean };
}

const Scores = z.object({
  results: z.array(z.object({
    id: z.number().int(),
    score: z.number().int().min(0).max(100).describe("fit of the job to the resume"),
    reason: z.string().describe("one short sentence"),
    visa: z.enum(["yes", "no", "unknown"]).describe("does the posting offer visa sponsorship / relocation"),
    english_ok: z.boolean().describe("true if the job can be done in English only (no other language required)"),
  })),
});

async function scoreBatch(resume: string, rows: any[]) {
  const max = config.jobs.maxDescriptionChars;
  const jobsText = (
    await Promise.all(rows.map(async (j) =>
      `### id ${j.id}\n${j.title} at ${j.company ?? "?"} (${j.location ?? j.country})\n${await mask((j.description ?? "").slice(0, max))}`))
  ).join("\n\n");
  const prompt = `Score each job against the candidate's resume. Return one result per job id.\n\n## Resume\n${resume}\n\n## Jobs\n${jobsText}`;
  return withFallback("jobs", (m) => m.withStructuredOutput(Scores).invoke(prompt));
}

/** Fetch, store, score and return listings worth sending. `includeJsearch` saves the JSearch quota. */
export async function runJobSearch({ includeJsearch = true } = {}): Promise<{ sent: any[]; found: number; note?: string }> {
  const p = await getProfile();
  if (!p.resume_text) return { sent: [], found: 0, note: "No resume yet. Upload your PDF resume in a DM to get started." };
  if (!p.roles_confirmed || !p.target_roles.length) return { sent: [], found: 0, note: "Target roles are not confirmed yet. Ask me to propose roles from your resume." };

  const listings: Listing[] = [];
  for (const role of p.target_roles) {
    listings.push(...(await adzuna(role)));
    if (includeJsearch) listings.push(...(await jsearch(role)));
  }
  listings.push(...(await webSearch(p.target_roles)));

  let found = 0;
  for (const l of listings) {
    const r = await query(
      `INSERT INTO jobs (external_id, source, title, company, location, country, url, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (external_id) DO NOTHING RETURNING id`,
      [l.externalId, l.source, l.title, l.company, l.location, l.country, l.url, l.description],
    );
    found += r.length;
  }

  const unscored = await query("SELECT * FROM jobs WHERE score IS NULL ORDER BY id DESC LIMIT $1", [config.jobs.maxScoredPerRun]);
  const resume = await mask(p.resume_text);
  for (let i = 0; i < unscored.length; i += 8) {
    const batch = unscored.slice(i, i + 8);
    try {
      const { results } = await scoreBatch(resume, batch);
      for (const s of results)
        await query("UPDATE jobs SET score=$2, reason=$3, visa=$4, english_ok=$5 WHERE id=$1", [s.id, s.score, s.reason, s.visa, s.english_ok]);
    } catch (e) {
      console.warn("[jobs] scoring failed:", (e as Error).message);
    }
  }

  // Domestic (India) roles need no visa; international ones must sponsor.
  const sent = await query(
    `UPDATE jobs SET notified = true
     WHERE id IN (SELECT id FROM jobs WHERE NOT notified AND score >= $1 AND english_ok AND (country = 'in' OR visa = 'yes'))
     RETURNING *`,
    [config.jobs.minScore],
  );
  sent.sort((a, b) => b.score - a.score);
  return { sent, found };
}

export function formatJobs(rows: any[]): string {
  return rows
    .map((j) => `**${j.score}** · ${j.title} — ${j.company ?? "?"} (${j.location ?? j.country.toUpperCase()})${j.country !== "in" ? " · visa ✓" : ""}\n${j.reason}\n<${j.url}>`)
    .join("\n\n");
}
