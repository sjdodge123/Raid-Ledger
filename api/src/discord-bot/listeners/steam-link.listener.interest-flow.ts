/**
 * Helpers for the Steam heart/interest flow (ROK-966).
 *
 * Extracted from steam-link.listener.ts to keep the listener under the
 * 300-line limit. All helpers are pure or operate through the caller's
 * Drizzle client.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { STEAM_INTEREST_BUTTON_IDS } from '../discord-bot.constants';
import {
  addDiscordInterest,
  findLinkedRlUser,
  setAutoHeartSteamUrlsPref,
} from './steam-link-interest.helpers';
import { replaceDmWithText } from './steam-link.listener.nomination-flow';

type Db = PostgresJsDatabase<typeof schema>;

/** Build the 3-button heart interest prompt action row. */
export function buildInterestButtonRow(
  gameId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.HEART}:${gameId}`)
      .setLabel('Interested')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.DISMISS}:${gameId}`)
      .setLabel('Not Interested')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${STEAM_INTEREST_BUTTON_IDS.AUTO}:${gameId}`)
      .setLabel('Always Auto-Interest')
      .setStyle(ButtonStyle.Primary),
  );
}

/**
 * Parse a `steam_interest_*` button custom ID into action + gameId.
 * Returns null when the custom ID doesn't match the expected shape.
 */
export function parseSteamInterestButtonId(
  customId: string,
): { action: string; gameId: number } | null {
  const parts = customId.split(':');
  if (parts.length !== 2) return null;
  const [action, gameIdStr] = parts;
  const gameId = parseInt(gameIdStr, 10);
  if (isNaN(gameId)) return null;
  const validActions: string[] = [
    STEAM_INTEREST_BUTTON_IDS.HEART,
    STEAM_INTEREST_BUTTON_IDS.DISMISS,
    STEAM_INTEREST_BUTTON_IDS.AUTO,
  ];
  if (!validActions.includes(action)) return null;
  return { action, gameId };
}

/**
 * Handle a heart-flow button click by updating the DM in place.
 * Returns true when the click was handled (regardless of action).
 */
export async function handleInterestButtonClick(
  db: Db,
  interaction: ButtonInteraction,
): Promise<boolean> {
  const parsed = parseSteamInterestButtonId(interaction.customId);
  if (!parsed) return false;

  const { action, gameId } = parsed;
  if (action === STEAM_INTEREST_BUTTON_IDS.DISMISS) {
    await replaceDmWithText(interaction, 'Dismissed.');
    return true;
  }

  const user = await findLinkedRlUser(db, interaction.user.id);
  if (!user) {
    await replaceDmWithText(interaction, 'Could not find your linked account.');
    return true;
  }

  if (action === STEAM_INTEREST_BUTTON_IDS.HEART) {
    await addDiscordInterest(db, user.id, gameId);
    await replaceDmWithText(interaction, 'Marked as interested!');
  } else if (action === STEAM_INTEREST_BUTTON_IDS.AUTO) {
    await addDiscordInterest(db, user.id, gameId);
    await setAutoHeartSteamUrlsPref(db, user.id, true);
    await replaceDmWithText(
      interaction,
      'Auto-interest enabled for future Steam URLs!',
    );
  }
  return true;
}
