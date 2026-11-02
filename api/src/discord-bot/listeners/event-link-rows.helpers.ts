import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

/** Discord rejects a message with more than 5 action rows (error 50035). */
export const MAX_ACTION_ROWS = 5;

/** One unfurl action row; `series` marks a Join Series row (ROK-1728). */
export interface UnfurlRowEntry<T> {
  row: T;
  series: boolean;
}

/** Tag an event card's rows: the signup row is primary, `seriesRow` is series. */
export function unfurlRowEntries<T>(result: {
  row?: T | undefined;
  seriesRow?: T | undefined;
}): UnfurlRowEntry<T>[] {
  const entries: UnfurlRowEntry<T>[] = [];
  if (result.row) entries.push({ row: result.row, series: false });
  if (result.seriesRow) entries.push({ row: result.seriesRow, series: true });
  return entries;
}

/**
 * Cap a multi-link unfurl at Discord's row limit: drop Join Series rows
 * from the end first, and only then trim primary rows.
 */
export function capActionRows<T>(
  entries: readonly UnfurlRowEntry<T>[],
  max: number = MAX_ACTION_ROWS,
): T[] {
  const kept = [...entries];
  for (let i = kept.length - 1; kept.length > max && i >= 0; i--) {
    if (kept[i]?.series) kept.splice(i, 1);
  }
  return kept.slice(0, max).map((e) => e.row);
}

/** PUG invite unfurl row: "Join Event" (pug_join) + a "View Event" link. */
export function buildInviteButtonRow(
  code: string,
  clientUrl: string,
  eventId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`pug_join:${code}`)
      .setLabel('Join Event')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setLabel('View Event')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clientUrl}/events/${eventId}`),
  );
}
