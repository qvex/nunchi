CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS notes (
  id          serial PRIMARY KEY,
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  embedding   vector(768)
);

CREATE TABLE IF NOT EXISTS tasks (
  id            serial PRIMARY KEY,
  title         text NOT NULL,
  due_at        timestamptz,
  recurrence    text NOT NULL DEFAULT 'none',   -- none | daily | weekdays | weekly | monthly
  status        text NOT NULL DEFAULT 'open',   -- open | done
  reminded_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE TABLE IF NOT EXISTS memories (
  id          serial PRIMARY KEY,
  fact        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  embedding   vector(768)
);

CREATE TABLE IF NOT EXISTS profile (
  id               int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  resume_text      text,
  target_roles     jsonb NOT NULL DEFAULT '[]',
  roles_confirmed  boolean NOT NULL DEFAULT false,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jobs (
  id           serial PRIMARY KEY,
  external_id  text UNIQUE NOT NULL,
  source       text NOT NULL,
  title        text NOT NULL,
  company      text,
  location     text,
  country      text,
  url          text,
  description  text,
  score        int,
  reason       text,
  visa         text,          -- yes | no | unknown
  english_ok   boolean,
  notified     boolean NOT NULL DEFAULT false,
  found_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_settings (
  agent     text PRIMARY KEY,
  enabled   boolean,
  provider  text,
  model     text
);

CREATE TABLE IF NOT EXISTS pii_map (
  token  text PRIMARY KEY,
  value  text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS pending_plans (
  channel_id  text PRIMARY KEY,
  original    text NOT NULL,
  steps       jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_history (
  id          serial PRIMARY KEY,
  channel_id  text NOT NULL,
  role        text NOT NULL,     -- user | assistant
  content     text NOT NULL,     -- stored masked (as the LLMs saw it)
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_history_channel ON chat_history (channel_id, id DESC);
