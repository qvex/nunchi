import { tool } from "@langchain/core/tools";
import type { z } from "zod";
import { mask, unmaskDeep } from "../llm/mask.ts";

/**
 * A LangChain tool whose arguments are unmasked before running (so the DB stores real values)
 * and whose output is masked before the LLM sees it.
 */
export function defineTool<S extends z.ZodObject<any>>(opts: {
  name: string;
  description: string;
  schema: S;
  run: (args: z.infer<S>) => Promise<unknown>;
}) {
  return tool(
    async (args: z.infer<S>) => {
      try {
        const out = await opts.run(await unmaskDeep(args));
        return await mask(typeof out === "string" ? out : JSON.stringify(out, null, 1));
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    { name: opts.name, description: opts.description, schema: opts.schema },
  );
}
