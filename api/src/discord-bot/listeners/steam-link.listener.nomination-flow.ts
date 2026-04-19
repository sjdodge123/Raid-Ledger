/**
 * Helpers for the Steam paste-to-nominate flow (ROK-1081).
 *
 * Extracted from steam-link.listener.ts so the listener stays under the
 * 300-line limit. These are pure UI/DOM-building helpers plus a thin
 * exception-to-DM translation layer around `LineupsService.nominate`.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ButtonInteraction,
} from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { STEAM_NOMINATE_BUTTON_IDS } from '../discord-bot.constants';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * DM payload for the nomination prompt — a plain content + components
 * shape accepted by both `dm.send()` and `interaction.update()`.
 */
export interface NominationPromptPayload {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
}

/** Prefix marking all steam_nominate_* custom IDs. */
const STEAM_NOMINATE_PREFIX = 'steam_nominate_';

/**
 * Build the 4-button nomination prompt action row.
 * Buttons: Nominate / Just Heart It / Always Auto-Nominate / Dismiss.
 */
export function buildNominationButtonRow(
  gameId: number,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STEAM_NOMINATE_BUTTON_IDS.NOMINATE}:${gameId}`)
      .setLabel('Nominate')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${STEAM_NOMINATE_BUTTON_IDS.HEART}:${gameId}`)
      .setLabel('Just Heart It')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${STEAM_NOMINATE_BUTTON_IDS.AUTO}:${gameId}`)
      .setLabel('Always Auto-Nominate')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${STEAM_NOMINATE_BUTTON_IDS.DISMISS}:${gameId}`)
      .setLabel('Dismiss')
      .setStyle(ButtonStyle.Secondary),
  );
}

/**
 * Parse a steam_nominate_* button custom ID into action + gameId.
 * Returns null for non-matching customIds.
 */
export function parseSteamNominateButtonId(
  customId: string,
): { action: string; gameId: number } | null {
  if (!customId.startsWith(STEAM_NOMINATE_PREFIX)) return null;
  const parts = customId.split(':');
  if (parts.length !== 2) return null;
  const [action, gameIdStr] = parts;
  const gameId = parseInt(gameIdStr, 10);
  if (isNaN(gameId)) return null;
  const validActions: string[] = [
    STEAM_NOMINATE_BUTTON_IDS.NOMINATE,
    STEAM_NOMINATE_BUTTON_IDS.HEART,
    STEAM_NOMINATE_BUTTON_IDS.AUTO,
    STEAM_NOMINATE_BUTTON_IDS.DISMISS,
  ];
  if (!validActions.includes(action)) return null;
  return { action, gameId };
}

/** Build the DM payload for the 4-button nomination prompt. */
export function buildNominationPrompt(game: {
  id: number;
  name: string;
}): NominationPromptPayload {
  return {
    content: `**${game.name}** — add to the current Community Lineup?`,
    components: [buildNominationButtonRow(game.id)],
  };
}

/**
 * Translate an error from LineupsService.nominate into the user-facing
 * DM copy prescribed by AC-6 and the button handler spec.
 */
export function translateNominateError(err: unknown, gameName: string): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Lineup has reached/i.test(msg)) return msg;
  if (/not in building status/i.test(msg)) {
    return 'Nominations have closed for the current lineup.';
  }
  if (/already nominated|uq_lineup_entry_game|duplicate/i.test(msg)) {
    return `**${gameName}** is already nominated for the current lineup.`;
  }
  return `Could not nominate **${gameName}** right now. Please try again.`;
}

/**
 * Interface the nomination flow needs from LineupsService.
 * Keeps this module independent of the NestJS service class.
 */
export interface LineupsNominator {
  nominate(
    lineupId: number,
    dto: { gameId: number; note?: string | null },
    userId: number,
  ): Promise<unknown>;
}

/**
 * Call LineupsService.nominate and return either a success-copy string or
 * a user-friendly error string. Never throws.
 */
export async function safeNominate(
  nominator: LineupsNominator,
  lineupId: number,
  gameId: number,
  gameName: string,
  userId: number,
  successCopy: string,
): Promise<string> {
  try {
    await nominator.nominate(lineupId, { gameId }, userId);
    return successCopy;
  } catch (err: unknown) {
    return translateNominateError(err, gameName);
  }
}

/** Ask the button interaction helper to update the DM in place. */
export async function replaceDmWithText(
  interaction: ButtonInteraction,
  content: string,
): Promise<void> {
  await interaction.update({ content, components: [] });
}

/** Fetch a game name by id. Falls back to "the game" on miss. */
export async function lookupGameName(db: Db, gameId: number): Promise<string> {
  const rows = await db
    .select({ name: schema.games.name })
    .from(schema.games)
    .where(eq(schema.games.id, gameId))
    .limit(1);
  return rows[0]?.name ?? 'the game';
}

/** Build the success DM copy for the Nominate / Auto-Nominate buttons. */
export function buildNominateSuccessCopy(
  action: string,
  gameName: string,
): string {
  if (action === STEAM_NOMINATE_BUTTON_IDS.AUTO) {
    return 'Auto-nominate enabled for future Steam URLs!';
  }
  return `Nominated **${gameName}** to the lineup!`;
}

/**
 * Deps for the nominate button handler: just the DB + optional service.
 * Kept loose so the listener can pass itself through without coupling.
 */
export interface NominateButtonDeps {
  db: Db;
  lineupsService?: LineupsNominator;
  findActiveBuildingLineupId(): Promise<number | null>;
  addInterest(userId: number, gameId: number): Promise<void>;
  findLinkedUser(discordId: string): Promise<{ id: number } | null>;
  setAutoNominatePref(userId: number, enabled: boolean): Promise<void>;
}

/**
 * Handle a nominate-flow button click by updating the DM in place.
 * Returns true when the customId matched; false otherwise so the caller
 * can fall back to the heart-flow handler.
 */
export async function handleNominateButtonClick(
  deps: NominateButtonDeps,
  interaction: ButtonInteraction,
  action: string,
  gameId: number,
): Promise<void> {
  if (action === STEAM_NOMINATE_BUTTON_IDS.DISMISS) {
    await replaceDmWithText(interaction, 'Dismissed.');
    return;
  }
  const user = await deps.findLinkedUser(interaction.user.id);
  if (!user) {
    await replaceDmWithText(interaction, 'Could not find your linked account.');
    return;
  }
  if (action === STEAM_NOMINATE_BUTTON_IDS.HEART) {
    await deps.addInterest(user.id, gameId);
    await replaceDmWithText(interaction, 'Marked as interested!');
    return;
  }
  await runNominateOnClick(deps, interaction, user.id, gameId, action);
}

/** Nominate path for the Nominate and Auto buttons. */
async function runNominateOnClick(
  deps: NominateButtonDeps,
  interaction: ButtonInteraction,
  userId: number,
  gameId: number,
  action: string,
): Promise<void> {
  const lineupId = await deps.findActiveBuildingLineupId();
  if (lineupId === null) {
    await replaceDmWithText(
      interaction,
      'Nominations have closed for the current lineup.',
    );
    return;
  }
  const gameName = await lookupGameName(deps.db, gameId);
  if (action === STEAM_NOMINATE_BUTTON_IDS.AUTO) {
    await deps.setAutoNominatePref(userId, true);
  }
  if (!deps.lineupsService) {
    await replaceDmWithText(interaction, 'Nominations are not available.');
    return;
  }
  try {
    await deps.lineupsService.nominate(lineupId, { gameId }, userId);
  } catch (err: unknown) {
    await replaceDmWithText(interaction, translateNominateError(err, gameName));
    return;
  }
  await replaceDmWithText(
    interaction,
    buildNominateSuccessCopy(action, gameName),
  );
}
