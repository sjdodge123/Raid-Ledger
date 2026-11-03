import type {
  ActionRowBuilder,
  ButtonBuilder,
  Client,
  TextChannel,
} from 'discord.js';

type ButtonRow = ActionRowBuilder<ButtonBuilder>;

/**
 * ROK-1728: an embed's action rows — a single row (legacy callers) or the
 * ordered list from `embedComponents()` (row 1 + the series Join row).
 */
export type EmbedRows = ButtonRow | readonly ButtonRow[];

/** Normalise {@link EmbedRows} to the mutable array discord.js expects. */
export function toRows(rows: EmbedRows | undefined): ButtonRow[] {
  if (!rows) return [];
  return isRowList(rows) ? [...rows] : [rows];
}

function isRowList(rows: EmbedRows): rows is readonly ButtonRow[] {
  return Array.isArray(rows);
}

/** DM components: the extra rows first, then the primary row (if any). */
export function buildDmRows(
  row: ButtonRow | undefined,
  extraRows: readonly ButtonRow[] | undefined,
): ButtonRow[] {
  return [...(extraRows ?? []), ...(row ? [row] : [])];
}

/** Fetch a sendable channel from a READY client; throws when offline/missing. */
export async function fetchReadyTextChannel(
  client: Client | null,
  channelId: string,
): Promise<TextChannel> {
  if (!client?.isReady()) {
    throw new Error('Discord bot is not connected');
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel || !('send' in channel)) {
    throw new Error(`Channel ${channelId} not found or not a text channel`);
  }
  return channel as TextChannel;
}
