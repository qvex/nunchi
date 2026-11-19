# Personal Assistant (v1)

A Discord bot backed by four agents:

| Agent | Does | Default model |
|---|---|---|
| orchestrator | Routes each message, proposes multi-agent plans and waits for **yes**, admin (agents on/off, change models), long-term memory | `anthropic/claude-haiku-5-5` |
| notes | Saves text notes, semantic search, summaries on request | `google/gemini-2.5-flash` |
| jobs | Resume → target roles → twice-daily job search (India, EU, South Korea, Japan), English-only, visa sponsorship for international roles, scored against your resume | `google/gemini-2.5-flash` |
| tasks | Plain-language tasks, reminders by DM, recurring tasks, 08:00 morning plan, 21:30 evening review | `openai/gpt-5-mini` |

Each agent falls back to `openrouter/google/gemini-2.5-flash` if its own model fails. Change models in `config/agents.yaml` or by chat ("switch tasks to anthropic claude-haiku-5-5").

Emails, phone numbers and names listed in `OWNER_NAMES` are replaced with tokens before any text goes to an LLM, and restored in replies and in the database.

## Setup

1. **Discord bot**
   - Go to https://discord.com/developers/applications, then New Application, then Bot. Copy the token.
   - On the Bot page, turn on **Message Content Intent**.
   - Under OAuth2, then URL Generator, pick scope `bot` with permissions *Send Messages* and *Read Message History*. Open the URL and add the bot to any server you're in, so you can DM it.
   - Get your user ID: Discord settings, then Advanced, then Developer Mode. Right-click your name, then Copy User ID.
2. **Keys**: fill in `.env` (copy of `.env.example`). You need Discord, Google (also used for embeddings) and at least one of the other LLM keys. The job sources Adzuna and JSearch are optional.
3. **Run**
   ```bash
   npm install
   npm run db            # Postgres + pgvector in Docker (localhost:5433)
   npm run ping-models   # checks every configured model and the embedding model answer
   npm run dev
   ```
   To run everything in Docker instead (e.g. on a VPS): `docker compose --profile app up -d --build`.

## Using it

DM the bot (in servers it answers only when @mentioned, and only to you):

- `note: the landlord said rent goes up 5% in March` · `what did I note about rent?` · `summarise my notes on the job search`
- `remind me to call mom friday 6pm` · `every weekday at 9:30 standup` · `what's on today?` · `done 3, 5`
- Upload your **resume PDF**. The bot proposes target roles; reply to confirm or edit them. Then try `search for jobs now`.
- `list agents` · `turn off jobs` · `remember that I prefer short replies`
- A request that needs two agents (e.g. `summarise my notes on X and add the follow-ups as tasks`) gets a plan back first. Reply **yes** to run it or **no** to cancel.

Schedule (IST, in `config/agents.yaml`): morning plan 08:00 · job checks 09:30 and 18:30 · evening review 21:30 · no reminders 23:00–07:00 (held reminders go out at 07:00).

## Cost notes (target under $10/month)

- Job scoring is capped at `jobs.maxScoredPerRun` listings per run, with descriptions cut to `maxDescriptionChars`.
- JSearch (Korea/Japan) runs only on the first daily check, to stay within its ~200 calls/month free tier.
- Web job search is one grounded Gemini call per run.

## Tests

```bash
npm test         # pure logic + Postgres tests (uses a separate assistant_test database)
npm run typecheck
```

## Not in v1 (planned)

- v2: web dashboard, chat, settings and usage logs; Google Calendar; email, ntfy and browser reminders.
- v3: reading LinkedIn/Indeed alert emails from Outlook; voice, file and link notes; application drafts and tracking; watching company career pages.
