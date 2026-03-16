import {
  Client,
  GatewayIntentBits,
  Guild,
  Partials,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import { BOT_TOKEN, GUILD_ID } from './config.js';

let client: Client | null = null;
let guild: Guild | null = null;

/** Create and connect the test bot client. */
export async function connect(): Promise<Client> {
  client = new Client({
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

  client.on('error', (err) => {
    console.error('[test-bot] Client error:', err);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Bot login timed out after 15s')),
      15_000,
    );
    client!.once('ready', () => {
      clearTimeout(timeout);
      console.log(`[test-bot] Ready as ${client!.user?.tag}`);
      resolve();
    });
    client!.login(BOT_TOKEN).catch((err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  guild = client.guilds.cache.get(GUILD_ID) ?? null;
  if (!guild) {
    guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
  }
  if (!guild) throw new Error(`Guild ${GUILD_ID} not found`);
  console.log(`[test-bot] Connected to guild: ${guild.name}`);

  return client;
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
