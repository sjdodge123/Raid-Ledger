/**
 * "Don't see your character? Import it" link button (ROK-2294).
 *
 * Sends a member from a Discord character/role step to the web characters
 * panel. Built only from the TRUSTED client URL (ROK-1627) — when none is
 * configured the button is omitted rather than pointing at localhost.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { SettingsService } from '../../settings/settings.service';

export const CHARACTER_IMPORT_LABEL = "Don't see your character? Import it";
export const CHARACTER_IMPORT_PATH = '/profile/gaming/characters';

/** The settings slice the link needs. */
export type CharacterImportSettings = Pick<
  SettingsService,
  'getTrustedClientUrl'
>;

/**
 * `<clientUrl>/profile/gaming/characters`, plus `?game=<id>` when the
 * event's game is known so the web panel opens Add Character for it.
 */
export function buildCharacterImportUrl(
  clientUrl: string,
  gameId?: number | null,
): string {
  const base = `${clientUrl.replace(/\/+$/, '')}${CHARACTER_IMPORT_PATH}`;
  return gameId != null ? `${base}?game=${gameId}` : base;
}

/** The import URL, or undefined when no trusted client URL is configured. */
export async function resolveCharacterImportUrl(
  settings: CharacterImportSettings,
  gameId?: number | null,
): Promise<string | undefined> {
  const clientUrl = await settings.getTrustedClientUrl();
  return clientUrl ? buildCharacterImportUrl(clientUrl, gameId) : undefined;
}

/** The Link-style import button (no custom_id, fires no interaction). */
export function buildCharacterImportButton(url: string): ButtonBuilder {
  return new ButtonBuilder()
    .setLabel(CHARACTER_IMPORT_LABEL)
    .setStyle(ButtonStyle.Link)
    .setURL(url);
}

/** One action row holding only the import button. */
export function buildCharacterImportRow(
  url: string,
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildCharacterImportButton(url),
  );
}
