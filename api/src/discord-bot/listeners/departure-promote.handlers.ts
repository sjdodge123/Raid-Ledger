import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  EmbedBuilder,
  type ButtonInteraction,
} from 'discord.js';
import type { Logger } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import type { NotificationService } from '../../notifications/notification.service';
import type { SignupsService } from '../../events/signups.service';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SIGNUP_EVENTS,
  type SignupEventPayload,
} from '../discord-bot.constants';

/** Dependencies for departure promote handlers. */
export interface DeparturePromoteDeps {
  db: PostgresJsDatabase<typeof schema>;
  notificationService: NotificationService;
  signupsService: SignupsService;
  eventEmitter: EventEmitter2;
  logger: Logger;
}

/** Find the first bench player (FIFO) for the given event. */
export async function findFirstBenchPlayer(
  deps: DeparturePromoteDeps,
  eventId: number,
): Promise<{ signupId: number; userId: number | null } | null> {
  const rows = await deps.db
    .select({
      signupId: schema.rosterAssignments.signupId,
      userId: schema.eventSignups.userId,
    })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'bench'),
        eq(schema.eventSignups.status, 'signed_up'),
      ),
    )
    .orderBy(schema.eventSignups.signedUpAt)
    .limit(1);
  return rows[0] ?? null;
}

/** Notify a promoted player and emit the signup event. */
export async function notifyPromotedPlayer(
  deps: DeparturePromoteDeps,
  eventId: number,
  benchPlayer: { signupId: number; userId: number | null },
  result: { role: string; position: number },
): Promise<void> {
  if (!benchPlayer.userId) return;
  const [event] = await deps.db
    .select({ title: schema.events.title })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  const discordUrl = await deps.notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await deps.notificationService.resolveVoiceChannelForEvent(eventId);
  await deps.notificationService.create({
    userId: benchPlayer.userId,
    type: 'bench_promoted',
    title: 'Promoted from Bench!',
    message: `A slot opened up in "${event?.title ?? 'event'}" and you've been moved from the bench to the roster as **${result.role}**!`,
    payload: {
      eventId,
      role: result.role,
      position: result.position,
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    },
  });
}

/** Emit a signup updated event for Discord embed sync. */
export function emitPromoteEvent(
  deps: DeparturePromoteDeps,
  eventId: number,
  benchPlayer: { signupId: number; userId: number | null },
): void {
  deps.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
    eventId,
    userId: benchPlayer.userId,
    signupId: benchPlayer.signupId,
    action: 'bench_promoted',
  } satisfies SignupEventPayload);
}

/** Build the result DM text for a successful promotion. */
export function buildPromoteResultText(result: {
  username: string;
  role: string;
  position: number;
  warning?: string;
}): string {
  let text = `**${result.username}** has been promoted to **${result.role}** (position ${result.position}).`;
  if (result.warning) {
    text += `\n\n⚠️ ${result.warning}`;
  }
  return text;
}

/** Disable action buttons and rebuild DM components. */
export function rebuildDmComponents(
  originalComponents: ButtonInteraction['message']['components'],
): ActionRowBuilder<ButtonBuilder>[] {
  const updated: ActionRowBuilder<ButtonBuilder>[] = [];
  for (const row of originalComponents) {
    if (row.type !== ComponentType.ActionRow) continue;
    const newRow = new ActionRowBuilder<ButtonBuilder>();
    for (const component of row.components) {
      if (component.type === ComponentType.Button) {
        const btn = ButtonBuilder.from(component);
        if (component.style !== ButtonStyle.Link) {
          btn.setDisabled(true);
        }
        newRow.addComponents(btn);
      }
    }
    if (newRow.components.length > 0) {
      updated.push(newRow);
    }
  }
  return updated;
}

/** Append a View Event link button if not already present. */
export function maybeAddViewEventButton(
  components: ActionRowBuilder<ButtonBuilder>[],
  originalComponents: ButtonInteraction['message']['components'],
  eventId: number | undefined,
  logger: Logger,
): void {
  const clientUrl = process.env.CLIENT_URL;
  if (!clientUrl) {
    logger.debug('Skipping View Event button: CLIENT_URL is not set');
    return;
  }
  if (!eventId) return;
  const hasLink = originalComponents.some(
    (row) =>
      row.type === ComponentType.ActionRow &&
      row.components.some(
        (c) => c.type === ComponentType.Button && c.style === ButtonStyle.Link,
      ),
  );
  if (hasLink) return;
  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/events/${eventId}`),
    ),
  );
}

/** Edit the original DM: append result text and disable buttons. */
export async function editDMResult(
  interaction: ButtonInteraction,
  resultText: string,
  eventId: number | undefined,
  logger: Logger,
): Promise<void> {
  try {
    const msg = interaction.message;
    const originalEmbed = msg.embeds[0];
    const embed = originalEmbed
      ? EmbedBuilder.from(originalEmbed).setDescription(
          `${originalEmbed.description ?? ''}\n\n${resultText}`,
        )
      : new EmbedBuilder().setDescription(resultText);
    const components = rebuildDmComponents(msg.components);
    maybeAddViewEventButton(components, msg.components, eventId, logger);
    await msg.edit({ embeds: [embed], components });
  } catch (error) {
    logger.warn(
      'Failed to edit departure promote DM: %s',
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
