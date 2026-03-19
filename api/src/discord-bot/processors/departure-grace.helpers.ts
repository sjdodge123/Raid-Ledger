import { Logger } from '@nestjs/common';
import { eq, and, sql, asc, notInArray } from 'drizzle-orm';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  DEPARTURE_PROMOTE_BUTTON_IDS,
  EMBED_COLORS,
} from '../discord-bot.constants';
import { computeSlotCapacity } from '../../events/signups-signup.helpers';
import { isSlotVacatedRelevant } from '../../notifications/slot-vacated-relevance.helpers';

/** Bundled dependencies passed from the processor. */
export interface DepartureGraceDeps {
  db: PostgresJsDatabase<typeof schema>;
  logger: Logger;
  voiceAttendanceService: {
    isUserActive(eventId: number, discordUserId: string): boolean;
  };
  notificationService: NotificationService;
  clientService: DiscordBotClientService;
}

/** Roster assignment shape used for departure logic. */
interface AssignmentRow {
  id: number;
  role: string | null;
  position: number;
}

/**
 * Check if the current time is during extension time (past the original
 * scheduled end but before extendedUntil). Departures during extension
 * time should be silently ignored — no notification, no status change.
 */
export function isDuringExtensionTime(
  event: typeof schema.events.$inferSelect,
): boolean {
  if (!event.extendedUntil) return false;
  const now = new Date();
  const scheduledEnd = event.duration[1];
  return now > scheduledEnd;
}

/**
 * Verify the event is still live (scheduled, not cancelled, within duration window).
 * Returns null if the event should be skipped.
 */
export async function verifyEventStillLive(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<typeof schema.events.$inferSelect | null> {
  const now = new Date();
  const [event] = await db
    .select()
    .from(schema.events)
    .where(
      and(
        eq(schema.events.id, eventId),
        eq(schema.events.isAdHoc, false),
        sql`${schema.events.cancelledAt} IS NULL`,
        sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
        sql`COALESCE(${schema.events.extendedUntil}, upper(${schema.events.duration})) >= ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(1);
  return event ?? null;
}

/**
 * Verify the signup still exists and is in an active status.
 * Returns null if the signup should be skipped.
 */
export async function verifySignupActive(
  db: PostgresJsDatabase<typeof schema>,
  signupId: number,
  eventId: number,
): Promise<typeof schema.eventSignups.$inferSelect | null> {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.eventId, eventId),
      ),
    )
    .limit(1);
  if (!signup) return null;
  if (signup.status !== 'signed_up' && signup.status !== 'tentative') {
    return null;
  }
  return signup;
}

/**
 * Determine if the event was at capacity before the departure.
 * Since the departure already happened (status set to 'departed'),
 * we count current active signups and add 1 for the just-departed user.
 * Returns false (suppress notifications) if event was not full or has no capacity limit.
 */
export async function wasEventFullBeforeDeparture(
  db: PostgresJsDatabase<typeof schema>,
  event: typeof schema.events.$inferSelect,
): Promise<boolean> {
  const capacity = resolveEventCapacity(event);
  if (capacity === null) return false;
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, event.id),
        notInArray(schema.eventSignups.status, [
          'departed',
          'declined',
          'roached_out',
        ]),
      ),
    )
    .limit(1);
  return Number(count) + 1 >= capacity;
}

/**
 * Check if a voice departure is relevant enough to notify the organizer (ROK-919).
 * Uses the shared relevance helper that applies MMO role + capacity rules.
 * Falls back to capacity-only check when no roster assignment exists.
 */
export async function isDepartureRelevant(
  db: PostgresJsDatabase<typeof schema>,
  event: typeof schema.events.$inferSelect,
  vacatedRole: string | null,
): Promise<boolean> {
  if (vacatedRole === 'bench') return false;
  // No assignment or non-MMO: fall back to capacity check
  if (!vacatedRole) return wasEventFullBeforeDeparture(db, event);
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type === 'mmo') {
    return isSlotVacatedRelevant(event, vacatedRole, 0);
  }
  return wasEventFullBeforeDeparture(db, event);
}

/** Resolve the total non-bench capacity for an event. */
function resolveEventCapacity(
  event: typeof schema.events.$inferSelect,
): number | null {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig) return computeSlotCapacity(slotConfig);
  return event.maxAttendees ?? null;
}

/**
 * Move the user's roster assignment to bench (free their slot).
 * Returns the original assignment if it was moved, or null.
 */
export async function moveToBench(
  db: PostgresJsDatabase<typeof schema>,
  signupId: number,
  eventId: number,
  logger: Logger,
): Promise<AssignmentRow | null> {
  const [assignment] = await db
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);

  if (!assignment || assignment.role === 'bench') return assignment ?? null;

  const nextPos = await findNextBenchPosition(db, eventId);
  await db
    .update(schema.rosterAssignments)
    .set({ role: 'bench', position: nextPos })
    .where(eq(schema.rosterAssignments.id, assignment.id));

  logger.log(
    `Moved signup ${signupId} from ${assignment.role}:${assignment.position} to bench:${nextPos} (departed)`,
  );
  return assignment;
}

/** Find the next available bench position for an event. */
async function findNextBenchPosition(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number> {
  const benchSlots = await db
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'bench'),
      ),
    );
  return benchSlots.reduce((max, r) => Math.max(max, r.position), 0) + 1;
}

/** Notify the event organizer about the departure. */
export async function notifyOrganizer(
  deps: Pick<DepartureGraceDeps, 'notificationService'>,
  event: typeof schema.events.$inferSelect,
  eventId: number,
  displayName: string,
): Promise<void> {
  if (!event.creatorId) return;
  const discordUrl = await deps.notificationService.getDiscordEmbedUrl(eventId);
  const voiceChannelId =
    await deps.notificationService.resolveVoiceChannelForEvent(eventId);

  await deps.notificationService.create({
    userId: event.creatorId,
    type: 'slot_vacated',
    title: 'Member Departed',
    message: `${displayName} departed — slot freed for "${event.title}"`,
    payload: {
      eventId,
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    },
  });
}

/**
 * Send a Discord DM to the event creator with Promote/Dismiss buttons (ROK-596).
 * Skips silently if: no bench players, creator has no Discord, bot not connected.
 */
export async function sendCreatorPromoteDM(
  deps: Pick<DepartureGraceDeps, 'db' | 'clientService' | 'logger'>,
  event: typeof schema.events.$inferSelect,
  departedName: string,
  assignment: AssignmentRow,
): Promise<void> {
  try {
    await trySendPromoteDM(deps, event, departedName, assignment);
  } catch (error) {
    deps.logger.warn(
      `Failed to send promote DM for event ${event.id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/** Inner logic for sendCreatorPromoteDM — separated for function length. */
async function trySendPromoteDM(
  deps: Pick<DepartureGraceDeps, 'db' | 'clientService' | 'logger'>,
  event: typeof schema.events.$inferSelect,
  departedName: string,
  assignment: AssignmentRow,
): Promise<void> {
  if (!deps.clientService.isConnected() || !event.creatorId) return;

  const hasBench = await hasBenchPlayers(deps.db, event.id);
  if (!hasBench) return;

  const creatorDiscordId = await lookupCreatorDiscord(deps.db, event.creatorId);
  if (!creatorDiscordId) return;

  const role = assignment.role!;
  const pos = assignment.position;
  const embed = buildDepartureEmbed(departedName, role, pos, event.title);
  const actionRow = buildPromoteButtons(event.id, role, pos);

  await deps.clientService.sendEmbedDM(
    creatorDiscordId,
    embed,
    actionRow,
    buildViewEventRow(event.id),
  );
  deps.logger.log(
    `Sent promote DM to creator ${creatorDiscordId} for event ${event.id}`,
  );
}

/** Check if bench players exist (excluding departed/declined/roached_out). */
async function hasBenchPlayers(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.rosterAssignments.id })
    .from(schema.rosterAssignments)
    .innerJoin(
      schema.eventSignups,
      eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
    )
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'bench'),
        notInArray(schema.eventSignups.status, [
          'departed',
          'declined',
          'roached_out',
        ]),
      ),
    )
    .orderBy(asc(schema.eventSignups.signedUpAt))
    .limit(1);
  return rows.length > 0;
}

/** Look up a user's Discord ID. */
async function lookupCreatorDiscord(
  db: PostgresJsDatabase<typeof schema>,
  creatorId: number,
): Promise<string | null> {
  const [creator] = await db
    .select({ discordId: schema.users.discordId })
    .from(schema.users)
    .where(eq(schema.users.id, creatorId))
    .limit(1);
  return creator?.discordId ?? null;
}

/** Build the departure embed. */
function buildDepartureEmbed(
  departedName: string,
  vacatedRole: string,
  vacatedPosition: number,
  eventTitle: string,
): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(EMBED_COLORS.ROSTER_UPDATE)
    .setTitle('Slot Vacated')
    .setDescription(
      `**${departedName}** departed from the **${vacatedRole}** slot (position ${vacatedPosition}) in **${eventTitle}**.\n\nWould you like to promote a bench player to fill it?`,
    );
}

/** Build promote/dismiss action row buttons. */
function buildPromoteButtons(
  eventId: number,
  vacatedRole: string,
  vacatedPosition: number,
): ActionRowBuilder<ButtonBuilder> {
  const base = `${eventId}:${vacatedRole}:${vacatedPosition}`;
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${DEPARTURE_PROMOTE_BUTTON_IDS.PROMOTE}:${base}`)
      .setLabel('Promote from Bench')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${DEPARTURE_PROMOTE_BUTTON_IDS.DISMISS}:${base}`)
      .setLabel('Leave Empty')
      .setStyle(ButtonStyle.Secondary),
  );
}

/** Build the optional "View Event" link row. */
function buildViewEventRow(eventId: number): ActionRowBuilder<ButtonBuilder>[] {
  const clientUrl = process.env.CLIENT_URL;
  if (!clientUrl) return [];
  return [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('View Event')
        .setStyle(ButtonStyle.Link)
        .setURL(`${clientUrl}/events/${eventId}`),
    ),
  ];
}
