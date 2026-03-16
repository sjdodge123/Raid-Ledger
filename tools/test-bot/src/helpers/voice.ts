import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} from '@discordjs/voice';
import { getGuild, getVoiceChannel } from '../client.js';
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
    await entersState(connection, VoiceConnectionStatus.Ready, 10_000);
  } catch (err) {
    connection.destroy();
    throw err;
  }
  console.log(`[test-bot] Joined voice channel: ${channel.name}`);
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
