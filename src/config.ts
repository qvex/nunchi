import "dotenv/config";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

export type Provider = "anthropic" | "openai" | "google" | "openrouter";
export const AGENTS = ["orchestrator", "notes", "jobs", "tasks"] as const;
export type AgentName = (typeof AGENTS)[number];

export interface ModelRef {
  provider: Provider;
  model: string;
}
export interface AgentConfig extends ModelRef {
  enabled: boolean;
  fallback?: ModelRef;
}

export interface Config {
  timezone: string;
  quietHours: { start: string; end: string };
  schedules: { morningPlan: string; jobChecks: string[]; eveningReview: string };
  embedding: { model: string; dims: number };
  defaultFallback: ModelRef;
  agents: Record<AgentName, AgentConfig>;
  jobs: {
    searchModel: string;
    adzunaCountries: string[];
    jsearchCountries: string[];
    maxScoredPerRun: number;
    minScore: number;
    maxDescriptionChars: number;
  };
}

export const config: Config = parse(
  readFileSync(new URL("../config/agents.yaml", import.meta.url), "utf8"),
);

export function env(name: string, required = false): string {
  const v = process.env[name]?.trim() ?? "";
  if (required && !v) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return v;
}
