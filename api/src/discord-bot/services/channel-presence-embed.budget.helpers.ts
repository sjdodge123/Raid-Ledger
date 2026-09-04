/**
 * ROK-1446 D11 / AC10 — the last gate before the presence message goes out.
 *
 * Discord's ledger: at most 10 embeds per message, at most 6000 characters
 * across all of them, and no empty field value. None of those fail gracefully —
 * the edit is rejected outright — so a busy room would simply stop updating.
 *
 * The degradation ladder is fixed by the design ("rosters cap per group"):
 *   1. drop the badge FIELDS from the group embeds. Price and co-op are
 *      shopping information; the roster is the point of the embed.
 *   2. re-render with the roster cap lowered to `DEGRADED_ROSTER_CAP`, which
 *      turns `**a** · **b** · … +2 more` into `**a** · **b** · **c** +37 more`.
 * A GROUP is never dropped to make room — the lead embed's `+N more groups`
 * overflow already bounds the count at nine, and a room where a whole game
 * silently vanished is worse than one whose rosters are shorter.
 */
import { Logger } from '@nestjs/common';
import type { ChannelEmbed } from '../embeds/embed-chrome.helpers';
import { ROSTER_NAME_CAP } from '../embeds/embed-roster.helpers';

/** Discord's hard ceiling on embeds per message. */
export const MAX_MESSAGE_EMBEDS = 10;

/** Headroom under Discord's 6000: a rejected edit costs the whole update. */
export const MESSAGE_CHAR_BUDGET = 5800;

/** The roster cap rung 2 re-renders at. */
export const DEGRADED_ROSTER_CAP = 3;

/** Stand-in for a field value Discord would reject as empty. */
export const EMPTY_FIELD_VALUE = '—';

const logger = new Logger('ChannelPresenceBudget');

/** Every slot Discord counts toward the 6000-character message total. */
function embedChars(embed: ChannelEmbed): number {
  const d = embed.data;
  const fields = (d.fields ?? []).reduce(
    (sum, f) => sum + f.name.length + f.value.length,
    0,
  );
  return (
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.author?.name.length ?? 0) +
    (d.footer?.text.length ?? 0) +
    fields
  );
}

/**
 * The character total Discord will measure this message against.
 *
 * Exported so a test can PROVE its fixture exceeds the budget rather than
 * assuming it — a degradation assertion made against a fixture that was never
 * over the line can never fail.
 *
 * @param embeds - The embeds about to be sent as one message.
 * @returns Total characters across every counted slot.
 */
export function messageChars(embeds: readonly ChannelEmbed[]): number {
  return embeds.reduce((sum, e) => sum + embedChars(e), 0);
}

/** Replace any field value Discord would reject; leave real values alone. */
function repairEmptyFields(embed: ChannelEmbed): ChannelEmbed {
  const fields = embed.data.fields ?? [];
  if (!fields.some((f) => f.value.trim() === '')) return embed;
  embed.setFields(
    fields.map((f) => ({
      ...f,
      value: f.value.trim() === '' ? EMPTY_FIELD_VALUE : f.value,
    })),
  );
  return embed;
}

/** Cap the embed count and make every surviving field legal. */
function normalize(embeds: ChannelEmbed[]): ChannelEmbed[] {
  return embeds.slice(0, MAX_MESSAGE_EMBEDS).map(repairEmptyFields);
}

/**
 * Rung 1 — strip the badge fields from the GROUP embeds only.
 *
 * The lead embed is index 0 and its fields are the "no game detected" roster
 * and the `+N more groups` overflow: information that exists nowhere else, so
 * it survives while the badges do not.
 */
function dropGroupFields(embeds: ChannelEmbed[]): ChannelEmbed[] {
  for (const embed of embeds.slice(1)) embed.setFields([]);
  return embeds;
}

/**
 * Render the presence message inside Discord's limits, degrading if it will not
 * fit (D11).
 *
 * @param render - Renders the whole message at a given roster cap. Called once
 *   when the message already fits, twice at most.
 * @returns At most ten embeds, at most `MESSAGE_CHAR_BUDGET` characters, with
 *   no empty field value and no group silently missing.
 */
export function applyBudget(
  render: (rosterCap: number) => ChannelEmbed[],
): ChannelEmbed[] {
  const full = normalize(render(ROSTER_NAME_CAP));
  if (messageChars(full) <= MESSAGE_CHAR_BUDGET) return full;

  const stripped = dropGroupFields(full);
  if (messageChars(stripped) <= MESSAGE_CHAR_BUDGET) {
    logger.warn(
      `presence message over ${String(MESSAGE_CHAR_BUDGET)} chars — dropped badge fields`,
    );
    return stripped;
  }

  const degraded = dropGroupFields(normalize(render(DEGRADED_ROSTER_CAP)));
  logger.warn(
    `presence message over ${String(MESSAGE_CHAR_BUDGET)} chars — dropped badge fields and capped rosters at ${String(DEGRADED_ROSTER_CAP)}`,
  );
  return degraded;
}
