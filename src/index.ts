import { migrate, pool } from "./db/client.ts";
import { client, startBot } from "./discord/bot.ts";
import { startScheduler } from "./scheduler/cron.ts";

await migrate();
console.log("[db] schema ready");
await startBot();
startScheduler();

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, async () => {
    await client.destroy();
    await pool.end();
    process.exit(0);
  });
