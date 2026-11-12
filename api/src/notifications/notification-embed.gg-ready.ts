/**
 * ROK-2187 — the `gg_ready` DM's primary button: a Link to the player's
 * GG <year> page. The payload stays origin-free (`{ year, url: '/gg/<year>' }`);
 * the absolute URL is built here from the trusted client URL.
 */
import { ButtonBuilder, ButtonStyle } from 'discord.js';

type Payload = Record<string, unknown> | undefined;

/** The payload's GG year, only when it is a plausible 4-digit integer. */
function ggYear(payload: Payload): number | null {
  const year = payload?.year;
  if (typeof year !== 'number' || !Number.isInteger(year)) return null;
  return year >= 2000 && year <= 9999 ? year : null;
}

/** `Open your GG <year>` → `<clientUrl>/gg/<year>`, or null without a year. */
export function buildGgReadyButton(
  payload: Payload,
  clientUrl: string,
): ButtonBuilder | null {
  const year = ggYear(payload);
  if (year === null) return null;
  return new ButtonBuilder()
    .setLabel(`Open your GG ${year}`)
    .setStyle(ButtonStyle.Link)
    .setURL(`${clientUrl}/gg/${year}`);
}
