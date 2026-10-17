import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} from '@discordjs/voice';
import { getVoiceChannel } from '../client.js';
import { GUILD_ID } from '../config.js';

/**
 * Join a voice channel. The test bot doesn't need to transmit audio —
 * simply being present triggers the production bot's voice-state listeners.
 */
export async function joinVoice(channelId: string): Promise<void> {
  const channel = getVoiceChannel(channelId);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: GUILD_ID,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }
  console.log(`[test-bot] Joined voice channel: ${channel.name}`);
}

/**
 * Opt-in retrying variant of {@link joinVoice}. The retry covers the TEST
 * BOT's own voice connection (a Discord-side handshake timeout on the
 * companion bot), not the product under test — so it is only for callers
 * where a flaky companion join would otherwise abort the run before its
 * cleanup could be checked. joinVoice itself stays single-attempt so its other
 * callers keep a clean one-shot signal. No delay between attempts: joinVoice
 * already waits up to 30s and destroys the failed connection before throwing.
 */
export async function joinVoiceWithRetry(
  channelId: string,
  attempts = 2,
): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await joinVoice(channelId);
      return;
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `[test-bot] joinVoice attempt ${attempt}/${attempts} failed: ${msg} — retrying`,
        );
      }
    }
  }
  throw lastErr;
}

/** Leave the current voice channel. */
export function leaveVoice(): void {
  const connection = getVoiceConnection(GUILD_ID);
  if (connection) {
    connection.destroy();
    console.log('[test-bot] Left voice channel');
  }
}

/** Move to a different voice channel. */
export async function moveToChannel(channelId: string): Promise<void> {
  leaveVoice();
  await joinVoice(channelId);
}

/** Get the list of members currently in a voice channel. */
export function getVoiceMembers(
  channelId: string,
): { id: string; tag: string }[] {
  const channel = getVoiceChannel(channelId);
  return channel.members.map((m) => ({
    id: m.id,
    tag: m.user.tag,
  }));
}
