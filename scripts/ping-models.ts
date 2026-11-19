// Checks every configured model (and the fallback + embedding model) answers. Run: npm run ping-models
import { AGENTS, config, type ModelRef } from "../src/config.ts";
import { makeModel } from "../src/llm/registry.ts";
import { genai } from "../src/llm/embed.ts";

const refs: [string, ModelRef][] = [
  ...AGENTS.map((a) => [a, config.agents[a]] as [string, ModelRef]),
  ["fallback", config.defaultFallback],
];
let failed = 0;
for (const [name, ref] of refs) {
  try {
    const r = await makeModel(ref).invoke("Reply with the single word: pong");
    console.log(`ok   ${name.padEnd(13)} ${ref.provider}/${ref.model} -> ${String(r.content).slice(0, 30)}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name.padEnd(13)} ${ref.provider}/${ref.model} -> ${(e as Error).message.split("\n")[0]}`);
  }
}
try {
  const e = await genai().models.embedContent({ model: config.embedding.model, contents: "hi", config: { outputDimensionality: config.embedding.dims } });
  console.log(`ok   embedding     ${config.embedding.model} -> ${e.embeddings?.[0]?.values?.length} dims`);
} catch (e) {
  failed++;
  console.log(`FAIL embedding     ${config.embedding.model} -> ${(e as Error).message.split("\n")[0]}`);
}
process.exit(failed ? 1 : 0);
