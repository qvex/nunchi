import { z } from "zod";
import { query, toVector } from "../db/client.ts";
import { embed } from "../llm/embed.ts";
import { defineTool } from "../tools/define.ts";
import { runAgent, type Turn } from "./run.ts";

export async function saveNote(content: string) {
  const [r] = await query("INSERT INTO notes (content, embedding) VALUES ($1, $2) RETURNING id", [content, toVector(await embed(content))]);
  return r.id as number;
}

export async function searchNotes(q: string, limit = 8) {
  return query(
    "SELECT id, content, created_at FROM notes ORDER BY embedding <=> $1 LIMIT $2",
    [toVector(await embed(q)), limit],
  );
}

const tools = [
  defineTool({
    name: "save_note",
    description: "Save a note exactly as the user gave it (do not rewrite or summarise it).",
    schema: z.object({ content: z.string() }),
    run: async ({ content }) => `Saved note #${await saveNote(content)}.`,
  }),
  defineTool({
    name: "search_notes",
    description: "Find notes by meaning (semantic search). Use for questions about past notes and before summarising a topic.",
    schema: z.object({ query: z.string(), limit: z.number().int().min(1).max(30).optional() }),
    run: async ({ query: q, limit }) => searchNotes(q, limit),
  }),
  defineTool({
    name: "list_notes",
    description: "List notes created in the last N days, newest first.",
    schema: z.object({ days: z.number().int().min(1).max(365) }),
    run: async ({ days }) =>
      query("SELECT id, content, created_at FROM notes WHERE created_at > now() - make_interval(days => $1) ORDER BY id DESC LIMIT 100", [days]),
  }),
  defineTool({
    name: "delete_note",
    description: "Delete a note by id. Only when the user explicitly asks.",
    schema: z.object({ id: z.number().int() }),
    run: async ({ id }) => ((await query("DELETE FROM notes WHERE id = $1 RETURNING id", [id])).length ? "Deleted." : "No such note."),
  }),
];

const SYSTEM = `You are the notes agent of a personal assistant.
- When the user gives you something to note, save it with save_note, unchanged, and confirm with its id.
- Only summarise when the user asks for a summary. Base summaries and answers strictly on notes returned by your tools, and cite note ids like (#12).
- If nothing relevant is found, say so; do not invent content.`;

export const runNotes = (input: string, history?: Turn[]) => runAgent("notes", { systemPrompt: SYSTEM, tools, input, history });
