import { createAgent } from "langchain";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import type { AgentName } from "../config.ts";
import { withFallback } from "../llm/registry.ts";
import { mask } from "../llm/mask.ts";
import { recall, memoryTools } from "../memory/longterm.ts";
import { nowForPrompt } from "../time.ts";

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function messageText(m: BaseMessage | undefined): string {
  if (!m) return "";
  const c = m.content;
  if (typeof c === "string") return c;
  return c.map((b: any) => (b.type === "text" ? b.text : "")).join("").trim();
}

/** Shared system-prompt footer: time, remembered facts, masking note. */
export async function contextBlock(input: string): Promise<string> {
  const facts = await Promise.all((await recall(input)).map(mask));
  return [
    `Current time: ${nowForPrompt()}. Interpret relative dates ("tomorrow", "Fri 6pm") in this timezone and send times to tools as ISO 8601 with offset.`,
    facts.length ? `Known facts about the user:\n- ${facts.join("\n- ")}` : "",
    "Personal details appear as tokens like [[PII_1a2b3c4d]]; copy them exactly, never guess what they stand for.",
    "Reply briefly and plainly; this is read in Discord.",
  ].filter(Boolean).join("\n\n");
}

/** Run one agent's tool loop on an already-masked input; returns the (masked) reply text. */
export async function runAgent(
  name: AgentName,
  opts: { systemPrompt: string; tools: any[]; input: string; history?: Turn[] },
): Promise<string> {
  const systemPrompt = `${opts.systemPrompt}\n\n${await contextBlock(opts.input)}`;
  return withFallback(name, async (model) => {
    const agent = createAgent({ model, tools: [...opts.tools, ...memoryTools], systemPrompt });
    const messages = [...(opts.history ?? []), { role: "user", content: opts.input }].map((t) =>
      t.role === "user" ? new HumanMessage(t.content) : new AIMessage(t.content));
    const res = await agent.invoke({ messages });
    return messageText(res.messages.at(-1)) || "(no reply)";
  });
}
