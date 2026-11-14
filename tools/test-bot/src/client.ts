import {
  Client,
  GatewayIntentBits,
  Guild,
  Partials,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import { BOT_TOKEN, GUILD_ID } from './config.js';
import { loginWithRetry, waitForReady } from './login-retry.js';

let client: Client | null = null;
let guild: Guild | null = null;

const LOGIN_TIMEOUT_MS = 30_000;
const LOGIN_ATTEMPTS = 2;

function newClient(): Client {
  const c = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });
  c.on('error', (err) => {
    console.error('[test-bot] Client error:', err);
  });
  return c;
}

async function loginOnce(): Promise<Client> {
  const c = newClient();
  client = c;
  await waitForReady(
    () => c.login(BOT_TOKEN),
    (cb) => c.once('ready', cb),
    LOGIN_TIMEOUT_MS,
  );
  console.log(`[test-bot] Ready as ${c.user?.tag}`);
  return c;
}

/** Create and connect the test bot client (one retry on a gateway stall). */
export async function connect(): Promise<Client> {
  const c = await loginWithRetry({
    attempt: loginOnce,
    cleanup: async () => {
      await client?.destroy();
      client = null;
    },
    attempts: LOGIN_ATTEMPTS,
    log: (m) => console.warn(m),
  });
  client = c;

  guild = c.guilds.cache.get(GUILD_ID) ?? null;
  if (!guild) {
    guild = await c.guilds.fetch(GUILD_ID).catch(() => null);
  }
  if (!guild) throw new Error(`Guild ${GUILD_ID} not found`);
  console.log(`[test-bot] Connected to guild: ${guild.name}`);

  return c;
}

/** Gracefully disconnect. */
export async function disconnect(): Promise<void> {
  if (client) {
    client.destroy();
    client = null;
    guild = null;
    console.log('[test-bot] Disconnected');
  }
}

export function getClient(): Client {
  if (!client?.isReady()) throw new Error('Bot not connected');
  return client;
}

export function getGuild(): Guild {
  if (!guild) throw new Error('Guild not available');
  return guild;
}

export function getTextChannel(channelId: string): TextChannel {
  const ch = getGuild().channels.cache.get(channelId);
  if (!ch?.isTextBased()) throw new Error(`Channel ${channelId} is not text`);
  return ch as TextChannel;
}

export function getVoiceChannel(channelId: string): VoiceChannel {
  const ch = getGuild().channels.cache.get(channelId);
  if (!ch?.isVoiceBased()) throw new Error(`Channel ${channelId} is not voice`);
  return ch as VoiceChannel;
}
