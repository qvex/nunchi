import { z } from "zod";
import { query, toVector } from "../db/client.ts";
import { embed } from "../llm/embed.ts";
import { defineTool } from "../tools/define.ts";

export async function remember(fact: string) {
  const [r] = await query("INSERT INTO memories (fact, embedding) VALUES ($1, $2) RETURNING id", [fact, toVector(await embed(fact))]);
  return r.id as number;
}

/** Facts most related to the current request, for the system prompt. */
export async function recall(text: string, k = 5): Promise<string[]> {
  const n = await query("SELECT count(*)::int AS n FROM memories");
  if (!n[0].n) return [];
  const rows = await query(
    "SELECT fact FROM memories ORDER BY embedding <=> $1 LIMIT $2",
    [toVector(await embed(text)), k],
  );
  return rows.map((r) => r.fact);
}

export const memoryTools = [
  defineTool({
    name: "remember_fact",
    description: "Save a lasting fact or preference about the user (e.g. 'prefers morning workouts'). Only for facts worth remembering long-term.",
    schema: z.object({ fact: z.string() }),
    run: async ({ fact }) => `Remembered (#${await remember(fact)}).`,
  }),
  defineTool({
    name: "list_memories",
    description: "List all saved long-term facts about the user.",
    schema: z.object({}),
    run: async () => query("SELECT id, fact, created_at FROM memories ORDER BY id"),
  }),
  defineTool({
    name: "forget_memory",
    description: "Delete a saved fact by id.",
    schema: z.object({ id: z.number().int() }),
    run: async ({ id }) => ((await query("DELETE FROM memories WHERE id = $1 RETURNING id", [id])).length ? "Forgotten." : "No such memory."),
  }),
];
