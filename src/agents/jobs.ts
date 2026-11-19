import { z } from "zod";
import { PDFParse } from "pdf-parse";
import { query } from "../db/client.ts";
import { defineTool } from "../tools/define.ts";
import { formatJobs, getProfile, runJobSearch } from "../jobs/search.ts";
import { runAgent, type Turn } from "./run.ts";

export async function saveResumePdf(data: Uint8Array) {
  const parser = new PDFParse({ data });
  const { text } = await parser.getText();
  await parser.destroy();
  if (!text.trim()) throw new Error("Could not read any text from that PDF (is it a scanned image?).");
  await getProfile();
  await query("UPDATE profile SET resume_text=$1, roles_confirmed=false, updated_at=now() WHERE id=1", [text]);
  return text.length;
}

const tools = [
  defineTool({
    name: "get_profile",
    description: "Get the user's resume text, target roles and whether the roles are confirmed.",
    schema: z.object({}),
    run: getProfile,
  }),
  defineTool({
    name: "set_target_roles",
    description: "Save target job roles. Set confirmed=true ONLY after the user has explicitly approved this exact list.",
    schema: z.object({ roles: z.array(z.string()).min(1).max(5), confirmed: z.boolean() }),
    run: async ({ roles, confirmed }) => {
      await getProfile();
      await query("UPDATE profile SET target_roles=$1, roles_confirmed=$2, updated_at=now() WHERE id=1", [JSON.stringify(roles), confirmed]);
      return confirmed ? "Roles confirmed; job checks will use them." : "Roles saved as a proposal; waiting for user confirmation.";
    },
  }),
  defineTool({
    name: "run_job_search_now",
    description: "Run a job search immediately and return new matching listings.",
    schema: z.object({}),
    run: async () => {
      const r = await runJobSearch();
      if (r.note) return r.note;
      return r.sent.length ? `${r.found} new listings fetched; ${r.sent.length} match:\n\n${formatJobs(r.sent)}` : `${r.found} new listings fetched; none matched the filters.`;
    },
  }),
  defineTool({
    name: "list_recent_jobs",
    description: "List matching jobs already sent in the last N days.",
    schema: z.object({ days: z.number().int().min(1).max(60) }),
    run: async ({ days }) =>
      formatJobs(await query("SELECT * FROM jobs WHERE notified AND found_at > now() - make_interval(days => $1) ORDER BY score DESC LIMIT 25", [days])) || "None.",
  }),
];

const SYSTEM = `You are the job-hunt agent of a personal assistant.
The user is looking for jobs in India (domestic) and in the EU, South Korea and Japan (international).
They only want English-language roles, and international roles must offer visa sponsorship. You never apply to jobs.
- After a new resume is uploaded, read it with get_profile, propose 2-5 target roles with seniority, save them with set_target_roles(confirmed=false) and ask the user to confirm or edit.
- Only call set_target_roles(confirmed=true) after the user approves.
- When listing jobs, keep the score, link and one-line reason.`;

export const runJobs = (input: string, history?: Turn[]) => runAgent("jobs", { systemPrompt: SYSTEM, tools, input, history });
