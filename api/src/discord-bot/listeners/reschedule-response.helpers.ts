import {
  ActionRowBuilder,
  ButtonBuilder,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { SignupsService } from '../../events/signups.service';
import { CharactersService } from '../../characters/characters.service';
import { EmbedSyncQueueService } from '../queues/embed-sync.queue';
import { DiscordEmojiService } from '../services/discord-emoji.service';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { RESCHEDULE_BUTTON_IDS } from '../discord-bot.constants';

const STATE_LABELS: Record<string, string> = {
  confirmed: '\n\n**\u2705 Confirmed for new time**',
  tentative: '\n\n**\u2753 Tentative**',
  declined: '\n\n**\u274C Declined**',
};

/** Subset of event row fields needed by the reschedule listener. */
export interface EventRow {
  id: number;
  title: string;
  cancelledAt: Date | null;
  gameId: number | null;
  slotConfig: unknown;
}

/** Dependencies shared across reschedule handler functions. */
export interface RescheduleDeps {
  db: PostgresJsDatabase<typeof schema>;
  signupsService: SignupsService;
  charactersService: CharactersService;
  embedSyncQueue: EmbedSyncQueueService;
  emojiService: DiscordEmojiService;
  activityLog: ActivityLogService;
  logger: Logger;
}

/** Options for signup re-confirmation. */
export interface ReconfirmOptions {
  characterId?: string;
  preferredRoles?: ('tank' | 'healer' | 'dps')[];
  slotRole?: string;
  signupStatus?: 'tentative';
}

/**
 * Build disabled-button action rows from existing message components.
 */
export function buildDisabledRows(
  components: { type: ComponentType; components: unknown[] }[],
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const row of components) {
    if (row.type !== ComponentType.ActionRow) continue;
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const comp of row.components) {
      const c = comp as { type: ComponentType; customId?: string };
      if (c.type !== ComponentType.Button) continue;
      const btn = ButtonBuilder.from(comp as never);
      if (typeof c.customId === 'string') btn.setDisabled(true);
      newRow.addComponents(btn);
    }
    if (newRow.components.length > 0) rows.push(newRow);
  }
  return rows;
}

/**
 * Build a state-updated embed with confirmed/tentative/declined suffix.
 */
export function buildStateEmbed(
  originalEmbed: { description: string | null },
  state: 'confirmed' | 'tentative' | 'declined',
): EmbedBuilder {
  const updated = EmbedBuilder.from(originalEmbed as never);
  const desc = originalEmbed.description ?? '';
  updated.setDescription(`${desc}${STATE_LABELS[state]}`);
  return updated;
}

/**
 * Check whether an error is a known Discord interaction error.
 */
export function isDiscordInteractionError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as { code: number }).code === 40060 ||
      (error as { code: number }).code === 10062)
  );
}

/** Parse role-select custom ID segments. */
export function parseRoleSelectParts(parts: string[]): {
  characterId: string | undefined;
  signupStatus: 'tentative' | undefined;
} {
  let characterId: string | undefined;
  let signupStatus: 'tentative' | undefined;

  if (parts.length === 3) {
    if (parts[2] === 'tentative') signupStatus = 'tentative';
    else characterId = parts[2];
  } else if (parts.length === 4) {
    characterId = parts[2];
    signupStatus = parts[3] === 'tentative' ? 'tentative' : undefined;
  }

  return { characterId, signupStatus };
}

/** Edit the original DM embed to show confirmed/declined state. */
export async function editDmEmbed(
  interaction: ButtonInteraction,
  state: 'confirmed' | 'tentative' | 'declined',
  logger: Logger,
): Promise<void> {
  try {
    const msg = interaction.message;
    if (!msg.embeds[0]) return;
    const embed = buildStateEmbed(msg.embeds[0], state);
    const components = buildDisabledRows(msg.components as never);
    await msg.edit({ embeds: [embed], components });
  } catch (error) {
    logger.warn(
      `Failed to edit reschedule DM embed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/** Edit DM embed from a select menu interaction context. */
export async function editDmEmbedFromSelect(
  interaction: StringSelectMenuInteraction,
  state: 'confirmed' | 'tentative' | 'declined',
  logger: Logger,
): Promise<void> {
  try {
    const botMessage = await findRescheduleDm(interaction);
    if (!botMessage?.embeds[0]) return;
    const embed = buildStateEmbed(botMessage.embeds[0], state);
    const components = buildDisabledRows(botMessage.components as never);
    await botMessage.edit({ embeds: [embed], components });
  } catch (error) {
    logger.warn(
      `Failed to edit reschedule DM embed from select: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

type MsgCh = {
  messages: {
    fetch: (o: {
      limit: number;
    }) => Promise<Map<string, ButtonInteraction['message']>>;
  };
};

/** Find the original reschedule DM in recent channel history. */
async function findRescheduleDm(
  interaction: StringSelectMenuInteraction,
): Promise<ButtonInteraction['message'] | null> {
  const channel = interaction.channel;
  if (!channel || !('messages' in channel)) return null;
  const messages = await (channel as unknown as MsgCh).messages.fetch({
    limit: 10,
  });
  const botId = interaction.client.user?.id;
  const match = [...messages.values()].find(
    (msg) =>
      msg.author.id === botId && msg.embeds.length > 0 && isRescheduleMsg(msg),
  );
  return match ?? null;
}

/** Check if a message has reschedule button components. */
function isRescheduleMsg(msg: ButtonInteraction['message']): boolean {
  return msg.components.some((row) =>
    (
      (row as unknown as { components: Array<{ customId?: string }> })
        .components ?? []
    ).some(
      (c) =>
        typeof c.customId === 'string' &&
        (c.customId.startsWith(RESCHEDULE_BUTTON_IDS.CONFIRM) ||
          c.customId.startsWith(RESCHEDULE_BUTTON_IDS.DECLINE)),
    ),
  );
}

/** Check if a button action is a reschedule action. */
export function isRescheduleAction(action: string): boolean {
  return (
    [
      RESCHEDULE_BUTTON_IDS.CONFIRM,
      RESCHEDULE_BUTTON_IDS.TENTATIVE,
      RESCHEDULE_BUTTON_IDS.DECLINE,
    ] as string[]
  ).includes(action);
}

/** Check if a select menu action is a reschedule select action. */
export function isSelectAction(action: string): boolean {
  return (
    [
      RESCHEDULE_BUTTON_IDS.CHARACTER_SELECT,
      RESCHEDULE_BUTTON_IDS.ROLE_SELECT,
    ] as string[]
  ).includes(action);
}

export async function safeEditReply(
  i: ButtonInteraction | StringSelectMenuInteraction,
  options: Parameters<ButtonInteraction['editReply']>[0],
): Promise<void> {
  try {
    await i.editReply(options);
  } catch (error: unknown) {
    if (isDiscordInteractionError(error)) return;
    throw error;
  }
}

/**
 * ROK-1269: log signup_reconfirmed when a user flips from pending → confirmed
 * via the Discord reschedule DM. Skipped on no-op repeat clicks. Used by
 * both linked and unlinked (anonymous) ack paths.
 */
export async function logDiscordAck(
  deps: RescheduleDeps,
  eventId: number,
  wasPending: boolean,
  updateSet: Record<string, unknown>,
  actor: { userId: number } | { discordUserId: string },
): Promise<void> {
  if (!wasPending || updateSet.confirmationStatus !== 'confirmed') return;
  const isLinked = 'userId' in actor;
  const metadata: Record<string, unknown> = { reason: 'discord-ack' };
  if (!isLinked) metadata.discordUserId = actor.discordUserId;
  await deps.activityLog.log(
    'event',
    eventId,
    'signup_reconfirmed',
    isLinked ? actor.userId : null,
    metadata,
  );
}

type DmState = 'confirmed' | 'tentative' | 'declined';

/** Look up the event fields the reschedule listener needs. */
export async function lookupRescheduleEvent(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventRow | null> {
  const [event] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      cancelledAt: schema.events.cancelledAt,
      gameId: schema.events.gameId,
      slotConfig: schema.events.slotConfig,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/** Resolve the user linked to a Discord account, if any. */
export async function findLinkedUserByDiscordId(
  db: PostgresJsDatabase<typeof schema>,
  discordId: string,
): Promise<{ id: number } | null> {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordId))
    .limit(1);
  return user ?? null;
}

/** Bind `editDmEmbed` to a logger for the button-handler contexts. */
export function dmEditFor(logger: Logger) {
  return (i: ButtonInteraction, s: DmState) => editDmEmbed(i, s, logger);
}

/** Bind `editDmEmbedFromSelect` to a logger for the select-menu contexts. */
export function selectDmEditFor(logger: Logger) {
  return (i: StringSelectMenuInteraction, s: DmState) =>
    editDmEmbedFromSelect(i, s, logger);
}
