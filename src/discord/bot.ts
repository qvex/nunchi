import { Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import { env } from "../config.ts";
import { addHistory, handleMessage } from "../graph/orchestrator.ts";
import { saveResumePdf } from "../agents/jobs.ts";

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel], // needed to receive DMs
});

const ownerId = () => env("DISCORD_OWNER_ID", true);

export function chunks(text: string, size = 1900): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n", size);
    if (cut < size / 2) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** Send a message to the owner's DMs and record it so replies have context. */
export async function notifyOwner(text: string) {
  const dm = await (await client.users.fetch(ownerId())).createDM();
  for (const c of chunks(text)) await dm.send(c);
  await addHistory(dm.id, "assistant", text);
}

async function onMessage(msg: Message) {
  if (msg.author.bot || msg.author.id !== ownerId()) return; // owner only
  const isDm = !msg.guild;
  if (!isDm && !msg.mentions.has(client.user!)) return; // in servers, only when mentioned
  const text = msg.content.replace(/<@!?\d+>/g, "").trim();

  try {
    if ("sendTyping" in msg.channel) await msg.channel.sendTyping();
    let input = text;
    const pdf = msg.attachments.find((a) => a.contentType?.includes("pdf") || a.name.toLowerCase().endsWith(".pdf"));
    if (pdf) {
      const buf = new Uint8Array(await (await fetch(pdf.url)).arrayBuffer());
      const chars = await saveResumePdf(buf);
      input = `${text}\n\n[I just uploaded my resume (${chars} characters). Read it, propose target roles and ask me to confirm.]`.trim();
    } else if (msg.attachments.size) {
      await msg.reply("I can only read PDF resumes for now; voice, images and other files come in a later version.");
      if (!text) return;
    }
    if (!input) return;
    const reply = await handleMessage(msg.channel.id, input);
    for (const c of chunks(reply)) await msg.reply(c);
  } catch (err) {
    console.error("[bot]", err);
    await msg.reply(`Something went wrong: ${(err as Error).message}`).catch(() => {});
  }
}

export async function startBot(): Promise<void> {
  client.on(Events.MessageCreate, onMessage);
  const ready = new Promise<void>((r) => client.once(Events.ClientReady, (c) => { console.log(`[bot] logged in as ${c.user.tag}`); r(); }));
  await client.login(env("DISCORD_TOKEN", true));
  await ready;
}
