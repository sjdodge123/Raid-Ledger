/**
 * ROK-1933 — the suggested-claim DM's buttons: `[Yes, it's mine]`
 * (`vclaim:yes:<profileId>`), `[Not me]` (`vclaim:no:<profileId>`) and the
 * `[Open the hub]` link. The L3 listener routes on the `vclaim:` ids.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  VALHEIM_CLAIM_BUTTON_IDS,
  VALHEIM_CLAIM_BUTTON_LABELS as CLAIM_SUGGEST_COPY,
} from './notification-embed.valheim-claim.constants';

/** The profile id from the payload, or null when absent or malformed. */
function profileIdOf(
  payload: Record<string, unknown> | undefined,
): number | null {
  const id = payload?.profileId;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0
    ? id
    : null;
}

/**
 * The Yes / Not me row.
 *
 * @param payload - The DM payload; must carry a positive `profileId`.
 * @returns The row, or null without a usable profile id.
 */
export function buildValheimClaimRow(
  payload: Record<string, unknown> | undefined,
): ActionRowBuilder<ButtonBuilder> | null {
  const profileId = profileIdOf(payload);
  if (profileId === null) return null;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VALHEIM_CLAIM_BUTTON_IDS.YES}:${profileId}`)
      .setLabel(CLAIM_SUGGEST_COPY.yes)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${VALHEIM_CLAIM_BUTTON_IDS.NO}:${profileId}`)
      .setLabel(CLAIM_SUGGEST_COPY.no)
      .setStyle(ButtonStyle.Secondary),
  );
}

/** The `[Open the hub]` link button, or null without a `hubUrl`. */
export function buildValheimOpenHubButton(
  payload: Record<string, unknown> | undefined,
): ButtonBuilder | null {
  const url = payload?.hubUrl;
  if (typeof url !== 'string' || url === '') return null;
  return new ButtonBuilder()
    .setLabel(CLAIM_SUGGEST_COPY.openHub)
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}
