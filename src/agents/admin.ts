import { z } from "zod";
import { AGENTS } from "../config.ts";
import { query } from "../db/client.ts";
import { getAgentConfig } from "../llm/registry.ts";
import { defineTool } from "../tools/define.ts";
import { runAgent, type Turn } from "./run.ts";

const PROVIDERS = ["anthropic", "openai", "google", "openrouter"] as const;
const SPECIALISTS = ["notes", "jobs", "tasks"] as const;

async function upsert(agent: string, fields: Record<string, unknown>) {
  const cols = Object.keys(fields);
  await query(
    `INSERT INTO agent_settings (agent, ${cols.join(",")}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(",")})
     ON CONFLICT (agent) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(",")}`,
    [agent, ...Object.values(fields)],
  );
}

const tools = [
  defineTool({
    name: "list_agents",
    description: "Show every agent with its model, provider, fallback and on/off state.",
    schema: z.object({}),
    run: async () =>
      (await Promise.all(AGENTS.map(async (a) => {
        const c = await getAgentConfig(a);
        return `${a}: ${c.enabled ? "on" : "off"} · ${c.provider}/${c.model} (fallback ${c.fallback!.provider}/${c.fallback!.model})`;
      }))).join("\n"),
  }),
  defineTool({
    name: "set_agent_enabled",
    description: "Turn a specialist agent on or off.",
    schema: z.object({ agent: z.enum(SPECIALISTS), enabled: z.boolean() }),
    run: async ({ agent, enabled }) => {
      await upsert(agent, { enabled });
      return `${agent} is now ${enabled ? "on" : "off"}.`;
    },
  }),
  defineTool({
    name: "set_agent_model",
    description: "Change which provider/model an agent uses. Confirm the exact model id with the user if unsure.",
    schema: z.object({ agent: z.enum(AGENTS), provider: z.enum(PROVIDERS), model: z.string() }),
    run: async ({ agent, provider, model }) => {
      await upsert(agent, { provider, model });
      return `${agent} now uses ${provider}/${model}. If it fails, the fallback model takes over.`;
    },
  }),
];

const SYSTEM = `You are the orchestrator and admin of a personal assistant with these agents: notes, jobs (job hunt), tasks (tasks & reminders).
You handle general chat, admin requests (list agents, turn agents on/off, change models) and long-term memory (remember/list/forget facts).
For admin changes, do exactly what was asked and report the result.`;

export const runAdmin = (input: string, history?: Turn[]) => runAgent("orchestrator", { systemPrompt: SYSTEM, tools, input, history });
