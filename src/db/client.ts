import pg from "pg";
import pgvector from "pgvector/pg";
import { readFileSync } from "node:fs";
import { env } from "../config.ts";

export const pool = new pg.Pool({ connectionString: env("DATABASE_URL", true) });
pool.on("connect", (client) => pgvector.registerTypes(client));

export async function query<T extends pg.QueryResultRow = any>(sql: string, params: unknown[] = []) {
  return (await pool.query<T>(sql, params)).rows;
}

export async function migrate() {
  // Extension must exist before pgvector type registration on new connections.
  const c = await new pg.Client({ connectionString: env("DATABASE_URL", true) });
  await c.connect();
  await c.query(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  await c.end();
}

export const toVector = (v: number[]) => pgvector.toSql(v);
