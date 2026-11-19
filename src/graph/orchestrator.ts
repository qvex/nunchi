import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { query } from "../db/client.ts";
import { mask, unmask } from "../llm/mask.ts";
import { getAgentConfig, withFallback } from "../llm/registry.ts";
import { runAdmin } from "../agents/admin.ts";
import { runJobs } from "../agents/jobs.ts";
import { runNotes } from "../agents/notes.ts";
import { runTasks } from "../agents/tasks.ts";
import type { Turn } from "../agents/run.ts";
import { nowForPrompt } from "../time.ts";

const SPECIALISTS = { notes: runNotes, jobs: runJobs, tasks: runTasks } as const;
type Specialist = keyof typeof SPECIALISTS;
const SPECIALIST_NAMES = Object.keys(SPECIALISTS) as [Specialist, ...Specialist[]];

const Step = z.object({ agent: z.enum(SPECIALIST_NAMES), instruction: z.string().describe("self-contained instruction for that agent") });
const Decision = z.object({
  kind: z.enum(["single", "multi", "self"]).describe(
    "single: one specialist handles it; multi: needs two or more specialists in sequence; self: chat, admin (agents/models on/off), or memory requests",
  ),
  agent: z.enum(SPECIALIST_NAMES).nullable().describe("for kind=single"),
  steps: z.array(Step).nullable().describe("for kind=multi, in execution order"),
});
type Decision = z.infer<typeof Decision>;
type PlanStep = z.infer<typeof Step>;

const ROUTER_PROMPT = `You route messages for a personal assistant. Specialists:
- notes: save notes, search past notes, summarise notes
- jobs: job hunt (resume, target roles, job searches, job listings)
- tasks: to-dos, reminders, daily plan, marking tasks done (e.g. "done 3, 5")
Use "self" for small talk, questions about the assistant, admin (list agents, turn agents on/off, change models) and memory ("remember that…", "what do you know about me").
Use the recent conversation to resolve short follow-ups (e.g. "yes", "the second one") to the agent that asked.`;

const State = Annotation.Root({
  channelId: Annotation<string>,
  input: Annotation<string>, // masked
  history: Annotation<Turn[]>,
  decision: Annotation<Decision | null>,
  plan: Annotation<PlanStep[] | null>,
  output: Annotation<string>,
});
type S = typeof State.State;

const YES = /^\s*(y|yes|yep|ok|okay|sure|go|go ahead|do it|confirm|proceed)\b/i;
const NO = /^\s*(n|no|nope|cancel|stop|don'?t)\b/i;

async function checkPending(s: S): Promise<Partial<S>> {
  const [p] = await query("DELETE FROM pending_plans WHERE channel_id = $1 RETURNING steps", [s.channelId]);
  if (!p) return {};
  if (YES.test(s.input)) return { plan: p.steps };
  if (NO.test(s.input)) return { output: "Okay, cancelled that plan." };
  return {}; // anything else: drop the stale plan and treat as a new request
}

async function route(s: S): Promise<Partial<S>> {
  const recent = s.history.slice(-6).map((t) => `${t.role}: ${t.content.slice(0, 400)}`).join("\n");
  const decision = await withFallback("orchestrator", (m) =>
    m.withStructuredOutput(Decision).invoke([
      { role: "system", content: `${ROUTER_PROMPT}\nCurrent time: ${nowForPrompt()}` },
      { role: "user", content: `Recent conversation:\n${recent || "(none)"}\n\nNew message:\n${s.input}` },
    ]),
  );
  return { decision };
}

async function disabledNote(agent: Specialist): Promise<string | null> {
  return (await getAgentConfig(agent)).enabled ? null : `The ${agent} agent is turned off. Say "turn on ${agent}" to enable it.`;
}

async function single(s: S): Promise<Partial<S>> {
  const agent = s.decision!.agent ?? "notes";
  return { output: (await disabledNote(agent)) ?? (await SPECIALISTS[agent](s.input, s.history)) };
}

async function self(s: S): Promise<Partial<S>> {
  return { output: await runAdmin(s.input, s.history) };
}

async function propose(s: S): Promise<Partial<S>> {
  const steps = s.decision!.steps ?? [];
  if (steps.length < 2) return single({ ...s, decision: { kind: "single", agent: steps[0]?.agent ?? "notes", steps: null } });
  await query(
    "INSERT INTO pending_plans (channel_id, original, steps) VALUES ($1,$2,$3) ON CONFLICT (channel_id) DO UPDATE SET original=$2, steps=$3, created_at=now()",
    [s.channelId, s.input, JSON.stringify(steps)],
  );
  const list = steps.map((st, i) => `${i + 1}. **${st.agent}**: ${st.instruction}`).join("\n");
  return { output: `This needs several agents. Here's the plan:\n${list}\n\nReply **yes** to run it or **no** to cancel.` };
}

async function runPlan(s: S): Promise<Partial<S>> {
  const parts: string[] = [];
  let previous = "";
  for (const [i, st] of s.plan!.entries()) {
    const off = await disabledNote(st.agent);
    if (off) { parts.push(`Step ${i + 1} skipped: ${off}`); continue; }
    const input = previous ? `${st.instruction}\n\nResult of the previous step:\n${previous}` : st.instruction;
    previous = await SPECIALISTS[st.agent](input);
    parts.push(`**Step ${i + 1} (${st.agent})**\n${previous}`);
  }
  return { output: parts.join("\n\n") };
}

const graph = new StateGraph(State)
  .addNode("checkPending", checkPending)
  .addNode("route", route)
  .addNode("single", single)
  .addNode("self", self)
  .addNode("propose", propose)
  .addNode("runPlan", runPlan)
  .addEdge(START, "checkPending")
  .addConditionalEdges("checkPending", (s) => (s.plan ? "runPlan" : s.output ? END : "route"), ["runPlan", "route", END])
  .addConditionalEdges("route", (s) => (s.decision!.kind === "multi" ? "propose" : s.decision!.kind), ["single", "self", "propose"])
  .addEdge("single", END)
  .addEdge("self", END)
  .addEdge("propose", END)
  .addEdge("runPlan", END)
  .compile();

export async function history(channelId: string, n = 10): Promise<Turn[]> {
  const rows = await query("SELECT role, content FROM chat_history WHERE channel_id = $1 ORDER BY id DESC LIMIT $2", [channelId, n]);
  return rows.reverse();
}

/** Record a message in the conversation (masked), e.g. scheduled messages the user may reply to. */
export async function addHistory(channelId: string, role: Turn["role"], text: string) {
  await query("INSERT INTO chat_history (channel_id, role, content) VALUES ($1,$2,$3)", [channelId, role, await mask(text)]);
}

/** Entry point for every message from the user. Returns the reply in plain (unmasked) text. */
export async function handleMessage(channelId: string, text: string): Promise<string> {
  const input = await mask(text);
  const res = await graph.invoke({ channelId, input, history: await history(channelId), decision: null, plan: null, output: "" });
  await addHistory(channelId, "user", text);
  await addHistory(channelId, "assistant", res.output);
  return unmask(res.output);
}
