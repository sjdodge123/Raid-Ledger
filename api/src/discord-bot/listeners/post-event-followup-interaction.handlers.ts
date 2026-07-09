import type { ButtonInteraction } from 'discord.js';
import type { Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { SchedulingPollResponseDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import type { StandalonePollService } from '../../lineups/standalone-poll/standalone-poll.service';
import type { NotificationService } from '../../notifications/notification.service';
import type { SettingsService } from '../../settings/settings.service';
import { resolvePostEventFollowupRecipients } from '../../notifications/post-event-followup.helpers';
import { runFollowupFanout } from '../../notifications/post-event-followup-fanout.helpers';
import { POST_EVENT_FOLLOWUP_BUTTON_IDS } from '../discord-bot.constants';

type Db = PostgresJsDatabase<typeof schema>;

/** Dependencies for the post-event follow-up interaction handlers (ROK-1371). */
export interface PostEventFollowupDeps {
  db: Db;
  standalonePollService: Pick<StandalonePollService, 'create'>;
  notificationService: Pick<NotificationService, 'createMany'>;
  settingsService: Pick<SettingsService, 'getClientUrl'>;
  logger: Logger;
}

/** Ended-event shape used by the follow-up interaction flow. */
export interface FollowupInteractionEvent {
  id: number;
  title: string;
  creatorId: number;
  gameId: number | null;
}

/** Parsed custom-id for a follow-up prompt button. */
export interface FollowupButtonParsed {
  action: string;
  endedEventId: number;
}

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message : 'Unknown error';

/** Parse `{action}:{endedEventId}`, claiming only `pef_*` custom ids. */
export function parsePostEventFollowupButton(
  customId: string,
): FollowupButtonParsed | null {
  const parts = customId.split(':');
  if (parts.length !== 2) return null;
  const [action, idStr] = parts;
  if (
    action !== POST_EVENT_FOLLOWUP_BUTTON_IDS.SCHEDULE &&
    action !== POST_EVENT_FOLLOWUP_BUTTON_IDS.POLL
  )
    return null;
  const endedEventId = parseInt(idStr, 10);
  if (isNaN(endedEventId)) return null;
  return { action, endedEventId };
}

/** Load the ended event for the follow-up flow (null when cascade-deleted). */
export async function lookupFollowupEvent(
  db: Db,
  eventId: number,
): Promise<FollowupInteractionEvent | null> {
  const [event] = await db
    .select({
      id: schema.events.id,
      title: schema.events.title,
      creatorId: schema.events.creatorId,
      gameId: schema.events.gameId,
    })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return event ?? null;
}

/**
 * [Schedule event] — replies with a deep-link to the prefilled create form
 * (ROK-1371 M3). Creates NOTHING and writes no sentinel, so abandon-and-retry
 * is native (re-clicking re-sends the same link).
 */
export async function handleScheduleClick(
  deps: PostEventFollowupDeps,
  interaction: ButtonInteraction,
  event: FollowupInteractionEvent,
): Promise<void> {
  const clientUrl = await deps.settingsService.getClientUrl();
  const params = new URLSearchParams({ followupForEventId: String(event.id) });
  if (event.gameId != null) params.set('gameId', String(event.gameId));
  await interaction.editReply({
    content: `Set a time for your follow-up here:\n${clientUrl}/events/new?${params.toString()}`,
  });
}

/** POLL single-fire claim: stamp `choice='poll'` iff still null. */
async function claimPollChoice(db: Db, eventId: number): Promise<boolean> {
  const rows = await db.execute<{ id: number }>(sql`
    UPDATE post_event_followup_sent SET choice = 'poll'
    WHERE event_id = ${eventId} AND choice IS NULL
    RETURNING id
  `);
  return Array.from(rows).length > 0;
}

/** Roll the POLL claim back so the organizer can retry (OQ-3). */
async function releasePollChoice(db: Db, eventId: number): Promise<void> {
  await db.execute(sql`
    UPDATE post_event_followup_sent SET choice = NULL WHERE event_id = ${eventId}
  `);
}

/** Create the StandalonePoll (no linkedEventId) or roll back + reply on failure. */
async function openFollowupPoll(
  deps: PostEventFollowupDeps,
  interaction: ButtonInteraction,
  event: FollowupInteractionEvent,
): Promise<SchedulingPollResponseDto | null> {
  try {
    const recipients = await resolvePostEventFollowupRecipients(
      deps.db,
      event.id,
      event.creatorId,
    );
    return await deps.standalonePollService.create(
      {
        gameId: event.gameId!,
        memberUserIds: recipients,
        // ROK-1371: attendees get the targeted vote DM below — keep them out of
        // the generic game-interest broadcast so they aren't double-DM'd.
        broadcastExcludeUserIds: recipients,
      },
      event.creatorId,
    );
  } catch (error) {
    await releasePollChoice(deps.db, event.id);
    deps.logger.warn(
      'Follow-up poll create failed (%d): %s',
      event.id,
      errMsg(error),
    );
    await interaction.editReply({
      content: "Couldn't start the poll — try again.",
    });
    return null;
  }
}

/** Fan out attendee vote DMs (best-effort; helper rolls its own claim back). */
async function fanOutPoll(
  deps: PostEventFollowupDeps,
  event: FollowupInteractionEvent,
  poll: SchedulingPollResponseDto,
): Promise<void> {
  try {
    await runFollowupFanout(
      { db: deps.db, notificationService: deps.notificationService },
      event.id,
      { lineupId: poll.lineupId, matchId: poll.id, subtype: 'post_event_poll' },
      event.creatorId,
    );
  } catch (error) {
    deps.logger.warn(
      'Follow-up poll fan-out failed (%d): %s',
      event.id,
      errMsg(error),
    );
  }
}

/**
 * [Start a poll] — single-fire guarded StandalonePoll create (no linkedEventId,
 * HARD CONSTRAINT 5) + immediate attendee fan-out (ROK-1371 M3).
 */
export async function handlePollClick(
  deps: PostEventFollowupDeps,
  interaction: ButtonInteraction,
  event: FollowupInteractionEvent,
): Promise<void> {
  if (!(await claimPollChoice(deps.db, event.id))) {
    await interaction.editReply({
      content: 'You already picked a follow-up for this event.',
    });
    return;
  }
  if (event.gameId == null) {
    await releasePollChoice(deps.db, event.id);
    await interaction.editReply({
      content: 'This event has no game — use Schedule event instead.',
    });
    return;
  }
  const poll = await openFollowupPoll(deps, interaction, event);
  if (!poll) return;
  await fanOutPoll(deps, event, poll);
  await interaction.editReply({
    content: 'Poll opened — attendees are being invited to vote.',
  });
}
