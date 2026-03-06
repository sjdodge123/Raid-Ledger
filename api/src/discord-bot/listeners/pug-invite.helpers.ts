import { Logger } from '@nestjs/common';
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type MessageComponentInteraction,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { PugsService } from '../../events/pugs.service';
import { EMBED_COLORS } from '../discord-bot.constants';
import type { CharacterDto } from '@raid-ledger/contract';

/** Dependencies shared across pug invite handler functions. */
export interface PugInviteDeps {
  db: PostgresJsDatabase<typeof schema>;
  charactersService: CharactersService;
  signupsService: SignupsService;
  pugsService: PugsService;
  logger: Logger;
}

/** Safely defer an interaction update, returning false on failure. */
export async function safeDeferUpdate(
  interaction: MessageComponentInteraction,
  logger: Logger,
): Promise<boolean> {
  if (interaction.replied || interaction.deferred) return true;
  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    logger.warn(
      'Failed to defer update for interaction %s: %s',
      interaction.id,
      error,
    );
    return false;
  }
}

/** Safely defer a reply, returning false on failure. */
export async function safeDeferReply(
  interaction: MessageComponentInteraction,
  logger: Logger,
  ephemeral = true,
): Promise<boolean> {
  if (interaction.replied || interaction.deferred) return true;
  try {
    await interaction.deferReply({ ephemeral });
    return true;
  } catch (error) {
    logger.warn(
      'Failed to defer reply for interaction %s: %s',
      interaction.id,
      error,
    );
    return false;
  }
}

/** Build an accepted embed for DM editing. */
export function buildAcceptedEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.SIGNUP_CONFIRMATION)
    .setTitle('Invite Accepted!')
    .setDescription(description)
    .setTimestamp();
}

/** Build a declined embed for DM editing. */
export function buildDeclinedEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.ERROR)
    .setTitle('Invite Declined')
    .setDescription('You declined the invite. No worries!')
    .setTimestamp();
}

/** Safely edit the original DM message with embed and no components. */
export async function safeEditDmEmbed(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  embed: EmbedBuilder,
): Promise<void> {
  try {
    await interaction.message.edit({ embeds: [embed], components: [] });
  } catch {
    // DM edit may fail
  }
}

/** Reply with an error and catch expired interactions. */
export async function safeErrorReply(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  content: string,
): Promise<void> {
  try {
    await interaction.editReply({ content });
  } catch {
    // Interaction may have expired
  }
}

/** Build character select menu options from a list of characters. */
export function buildCharacterOptions(
  characters: CharacterDto[],
): { label: string; value: string; description?: string; default?: boolean }[] {
  const mainChar = characters.find((c) => c.isMain);
  return characters.slice(0, 25).map((char) => {
    const parts: string[] = [];
    if (char.class) {
      parts.push(char.spec ? `${char.class} (${char.spec})` : char.class);
    }
    if (char.level) parts.push(`Level ${char.level}`);
    if (char.isMain) parts.push('\u2B50');
    return {
      label: char.name,
      value: `${char.id}`,
      description: parts.join(' \u2014 ') || undefined,
      default: characters.length > 1 && mainChar?.id === char.id,
    };
  });
}

/** Build a role select menu row. */
export function buildRoleSelectRow(
  customId: string,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select your role')
    .addOptions([
      { label: 'Tank', value: 'tank', emoji: '\uD83D\uDEE1\uFE0F' },
      { label: 'Healer', value: 'healer', emoji: '\uD83D\uDC9A' },
      { label: 'DPS', value: 'dps', emoji: '\u2694\uFE0F' },
    ]);
  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );
}

/** Build role select content text. */
export function buildRoleSelectContent(
  eventTitle: string,
  characterInfo?: { name: string; role: string | null },
): string {
  if (characterInfo) {
    const roleHint = characterInfo.role
      ? ` (current: ${characterInfo.role})`
      : '';
    return `Playing as **${characterInfo.name}**${roleHint} for **${eventTitle}** \u2014 select your role:`;
  }
  const clientUrl = process.env.CLIENT_URL ?? '';
  const nudge = clientUrl
    ? `\nTip: [Import a character](${clientUrl}/characters) to skip this step next time.`
    : '';
  return `Select your role for **${eventTitle}**:${nudge}`;
}

/** Capitalize the first letter of a role name. */
export function capitalizeRole(role: string): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}
