/**
 * Shared dropdown builders for character and role selection menus.
 * Used by both SignupInteractionListener and RescheduleResponseListener
 * to avoid drift between the two flows (ROK-537).
 */

import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  type ComponentEmojiResolvable,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type EmbedBuilder,
} from 'discord.js';
import type { CharacterDto } from '@raid-ledger/contract';
import type { DiscordEmojiService } from '../services/discord-emoji.service';

export interface CharacterSelectOptions {
  /** The custom ID prefix to use (e.g. SIGNUP_BUTTON_IDS.CHARACTER_SELECT) */
  customIdPrefix: string;
  eventId: number;
  eventTitle: string;
  characters: CharacterDto[];
  emojiService: DiscordEmojiService;
  /** Optional suffix appended after eventId (e.g. 'tentative') */
  customIdSuffix?: string;
  /** Optional event embed to show alongside the dropdown */
  embed?: EmbedBuilder;
}

export interface RoleSelectOptions {
  /** The custom ID prefix to use (e.g. SIGNUP_BUTTON_IDS.ROLE_SELECT) */
  customIdPrefix: string;
  eventId: number;
  emojiService: DiscordEmojiService;
  characterId?: string;
  characterInfo?: { name: string; role: string | null };
  /** Optional suffix appended after the last segment (e.g. 'tentative') */
  customIdSuffix?: string;
  /** Content text prefix for the character line. Defaults to "Signing up as" */
  characterVerb?: string;
  /** Optional event embed to show alongside the dropdown */
  embed?: EmbedBuilder;
}

/** Build character dropdown option entries from character data. */
function buildCharacterOptions(opts: CharacterSelectOptions): Array<{
  label: string;
  value: string;
  description?: string;
  emoji?: ComponentEmojiResolvable;
  default: boolean;
}> {
  const mainChar = opts.characters.find((c) => c.isMain);
  return opts.characters.slice(0, 25).map((char) => {
    const parts: string[] = [];
    if (char.class) {
      parts.push(char.spec ? `${char.class} (${char.spec})` : char.class);
    }
    if (char.level) parts.push(`Level ${char.level}`);
    if (char.isMain) parts.push('\u2B50');
    const classEmoji = char.class
      ? opts.emojiService.getClassEmojiComponent(char.class)
      : undefined;
    return {
      label: char.name,
      value: char.id,
      description: parts.join(' \u2014 ') || undefined,
      emoji: classEmoji,
      default: false,
    };
  });
}

/**
 * Build a character select dropdown menu and send it as an ephemeral reply.
 */
export async function showCharacterSelect(
  interaction: ButtonInteraction,
  opts: CharacterSelectOptions,
): Promise<void> {
  const options = buildCharacterOptions(opts);
  let customId = `${opts.customIdPrefix}:${opts.eventId}`;
  if (opts.customIdSuffix) customId += `:${opts.customIdSuffix}`;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select a character')
    .addOptions(options);
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );
  await interaction.editReply({
    content: `Pick a character for **${opts.eventTitle}**`,
    components: [row],
    embeds: opts.embed ? [opts.embed] : [],
  });
}

/** Build the role option entries with emoji components. */
function buildRoleOptions(
  emojiService: DiscordEmojiService,
): Array<{ label: string; value: string; emoji?: ComponentEmojiResolvable }> {
  return [
    {
      label: 'Tank',
      value: 'tank',
      emoji: emojiService.getRoleEmojiComponent('tank'),
    },
    {
      label: 'Healer',
      value: 'healer',
      emoji: emojiService.getRoleEmojiComponent('healer'),
    },
    {
      label: 'DPS',
      value: 'dps',
      emoji: emojiService.getRoleEmojiComponent('dps'),
    },
  ];
}

/** Build the content text for the role select prompt. */
function buildRoleSelectContent(opts: RoleSelectOptions): string {
  const verb = opts.characterVerb ?? 'Signing up as';
  const roleHint = opts.characterInfo?.role
    ? ` (current: ${opts.characterInfo.role})`
    : '';
  return opts.characterInfo
    ? `${verb} **${opts.characterInfo.name}**${roleHint} — select your preferred role(s):`
    : 'Select your preferred role(s):';
}

/**
 * Build a role select dropdown menu and send it as an ephemeral reply.
 */
export async function showRoleSelect(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  opts: RoleSelectOptions,
): Promise<void> {
  let customId = opts.characterId
    ? `${opts.customIdPrefix}:${opts.eventId}:${opts.characterId}`
    : `${opts.customIdPrefix}:${opts.eventId}`;
  if (opts.customIdSuffix) customId += `:${opts.customIdSuffix}`;
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder('Select your preferred role(s)')
    .setMinValues(1)
    .setMaxValues(3)
    .addOptions(buildRoleOptions(opts.emojiService));
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    selectMenu,
  );
  await interaction.editReply({
    content: buildRoleSelectContent(opts),
    components: [row],
    embeds: opts.embed ? [opts.embed] : [],
  });
}
