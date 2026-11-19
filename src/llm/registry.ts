import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { config, env, type AgentConfig, type AgentName, type ModelRef, type Provider } from "../config.ts";
import { query } from "../db/client.ts";

export function makeModel({ provider, model }: ModelRef): BaseChatModel {
  switch (provider) {
    case "anthropic":
      return new ChatAnthropic({ model, apiKey: env("ANTHROPIC_API_KEY", true), maxTokens: 4096 });
    case "openai":
      return new ChatOpenAI({ model, apiKey: env("OPENAI_API_KEY", true) });
    case "google":
      return new ChatGoogleGenerativeAI({ model, apiKey: env("GOOGLE_API_KEY", true) });
    case "openrouter":
      return new ChatOpenAI({
        model,
        apiKey: env("OPENROUTER_API_KEY", true),
        configuration: { baseURL: "https://openrouter.ai/api/v1" },
      });
    default:
      throw new Error(`Unknown provider: ${provider satisfies never}`);
  }
}

/** YAML config merged with overrides saved from chat (agent_settings table). */
export async function getAgentConfig(name: AgentName): Promise<AgentConfig> {
  const base = config.agents[name];
  const [row] = await query("SELECT * FROM agent_settings WHERE agent = $1", [name]);
  return {
    provider: (row?.provider ?? base.provider) as Provider,
    model: row?.model ?? base.model,
    enabled: row?.enabled ?? base.enabled,
    fallback: base.fallback ?? config.defaultFallback,
  };
}

/**
 * Run `fn` with the agent's primary model; if it throws (bad key, outage, rate limit),
 * retry once with the fallback model.
 */
export async function withFallback<T>(name: AgentName, fn: (m: BaseChatModel) => Promise<T>): Promise<T> {
  const cfg = await getAgentConfig(name);
  try {
    return await fn(makeModel(cfg));
  } catch (err) {
    const fb = cfg.fallback!;
    console.warn(`[llm] ${name} primary ${cfg.provider}/${cfg.model} failed, using ${fb.provider}/${fb.model}:`, (err as Error).message);
    return await fn(makeModel(fb));
  }
}
