import { GoogleGenAI } from "@google/genai";
import { config, env } from "../config.ts";
import { mask } from "./mask.ts";

let ai: GoogleGenAI | undefined;
export const genai = () => (ai ??= new GoogleGenAI({ apiKey: env("GOOGLE_API_KEY", true) }));

/** Embedding of the masked text (raw personal details never leave the machine). */
export async function embed(text: string): Promise<number[]> {
  const res = await genai().models.embedContent({
    model: config.embedding.model,
    contents: await mask(text),
    config: { outputDimensionality: config.embedding.dims },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values) throw new Error("Embedding API returned no vector");
  return values;
}
