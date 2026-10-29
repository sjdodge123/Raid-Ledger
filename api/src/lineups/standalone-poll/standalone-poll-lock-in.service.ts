/**
 * Lock-in side effects shared by both doors into a poll lock-in (ROK-2032 D5):
 * the legacy `POST …/complete` (after `POST /events`) and the claim-first
 * `POST …/lock-in`, which creates the event only after claiming the match.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  type CreateEventDto,
  type EventResponseDto,
  type RescheduleEventDto,
  type LockInSchedulingPollDto,
  type LockInSchedulingPollResponseDto,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import type { completeStandalonePoll } from './standalone-poll-query.helpers';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { EventGuildTagService } from '../../events/event-guild-tag.service';
import { assertSchedulingMatchUsable } from '../../events/event-poll-provenance.helpers';
import { isOperatorOrAdmin } from '../../events/controller.helpers';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import { SettingsService } from '../../settings/settings.service';
import { runLockInFanout, type LockIn } from './standalone-poll-lockin.helpers';
import {
  createLockedInPollEvent,
  type LockInCreateDeps,
} from './standalone-poll-lock-in-create.helpers';
import { rescheduleLockedInPoll } from './standalone-poll-reschedule-lock-in.helpers';
import { LineupNotificationService } from '../lineup-notification.service';
import { EmbedSyncQueueService } from '../../discord-bot/queues/embed-sync.queue';
import { NotificationService } from '../../notifications/notification.service';

/** No-op rejection swallower for fire-and-forget emits. */
const noop = (): void => {};

/** The authenticated caller, as the hub-tag check needs it. */
export type LockInActor = Parameters<EventGuildTagService['assertCreate']>[0];

/** What `completeStandalonePoll` reported for a successful flip. */
export type CompletedPoll = Awaited<ReturnType<typeof completeStandalonePoll>>;

/** One completion handed to {@link StandalonePollLockInService.afterComplete}. */
export interface CompletedLockIn {
  matchId: number;
  eventId: number | undefined;
  startTime: string | undefined;
  creatorId: number | undefined;
  benchUserIds?: ReadonlySet<number> | undefined;
}

@Injectable()
export class StandalonePollLockInService {
  private readonly logger = new Logger(StandalonePollLockInService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly schedulingPollEmbed: SchedulingPollEmbedService,
    private readonly signupsService: SignupsService,
    private readonly settingsService: SettingsService,
    private readonly notifications: StandalonePollNotificationService,
    private readonly lineupNotifications: LineupNotificationService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => EmbedSyncQueueService))
    private readonly embedSyncQueue: EmbedSyncQueueService,
    private readonly guildTag: EventGuildTagService,
    private readonly notificationService: NotificationService,
  ) {}

  /**
   * ROK-2032: claim the poll, then create + link its event, then run the
   * awaited signup step (ROK-2031). DMs and EVENT CREATED fire afterwards.
   * The loser of a concurrent lock-in gets a 409 and creates nothing.
   */
  async lockIn(
    matchId: number,
    user: LockInActor,
    body: LockInSchedulingPollDto,
  ): Promise<LockInSchedulingPollResponseDto> {
    const caller = { id: user.id, isAdmin: isOperatorOrAdmin(user.role) };
    // A pre-claim loser's 400 becomes the 409 inside the helper (only there).
    const created = await createLockedInPollEvent(
      this.createDeps(user, caller.isAdmin),
      { matchId, caller, body },
    );
    this.schedulingPollEmbed.fireUpdateEmbed(matchId);
    // D4: no start time → no slot voters to sign up, nothing to announce.
    // Always `announce: true`: this path refuses reschedule polls.
    if (body.startTime !== undefined) {
      await this.startLockInFanout({
        matchId,
        eventId: created.event.id,
        startTime: body.startTime,
        creatorId: user.id,
        announce: true,
        benchUserIds: created.bench,
      });
    }
    const { event, benchPickFallback } = created;
    return { event, benchPickFallback };
  }

  /**
   * ROK-2040: claim a reschedule poll, then move its event in place, then
   * run the legacy `complete()` side effects (signups, DMs, UPDATED re-emit).
   * The loser of a concurrent lock-in gets a 409 and moves nothing.
   */
  async rescheduleLockIn(
    matchId: number,
    user: LockInActor,
    dto: RescheduleEventDto,
  ): Promise<EventResponseDto> {
    const caller = { id: user.id, isAdmin: isOperatorOrAdmin(user.role) };
    const moved = await rescheduleLockedInPoll(
      {
        db: this.db,
        eventsService: this.eventsService,
        notificationService: this.notificationService,
        logger: this.logger,
      },
      { matchId, caller, dto },
    );
    await this.afterComplete(
      {
        ok: true,
        linkedEventId: moved.eventId,
        linkedEventCancelled: moved.eventCancelled,
      },
      {
        matchId,
        eventId: moved.eventId,
        startTime: dto.startTime,
        creatorId: user.id,
      },
    );
    return moved.event;
  }

  /** Side effects of a successful legacy `complete()`. */
  async afterComplete(
    result: CompletedPoll,
    lockIn: CompletedLockIn,
  ): Promise<void> {
    const { matchId, eventId, startTime } = lockIn;
    // ROK-1461: lock-in flips the match to `scheduled` — re-render the poll
    // embed so its author line and colour follow.
    this.schedulingPollEmbed.fireUpdateEmbed(matchId);
    // Only that slot's yes-voters are signed up (ROK-1844). ROK-2024:
    // announce once, after those signups, and never for a reschedule
    // (`linkedEventId`). ROK-2031: awaited, so the roster is populated.
    if (eventId && startTime) {
      await this.startLockInFanout({
        matchId,
        eventId,
        startTime,
        creatorId: lockIn.creatorId,
        announce: !result.linkedEventId,
        benchUserIds: lockIn.benchUserIds,
      });
    }
    if (result.linkedEventId && !result.linkedEventCancelled) {
      await this.reemitLinkedEvent(result.linkedEventId);
    }
  }

  /** Bind the create-side deps: hub-tag check, then poll provenance. */
  private createDeps(user: LockInActor, isStaff: boolean): LockInCreateDeps {
    return {
      db: this.db,
      eventsService: this.eventsService,
      signupsService: this.signupsService,
      logger: this.logger,
      assertCreate: async (dto: CreateEventDto): Promise<void> => {
        await this.guildTag.assertCreate(user, dto);
        await assertSchedulingMatchUsable(this.db, dto, {
          id: user.id,
          isStaff,
        });
      },
    };
  }

  /** Sign up the slot voters (awaited), then fire DMs + announce. */
  private startLockInFanout(lockIn: LockIn): Promise<void> {
    return runLockInFanout(
      {
        db: this.db,
        signupsService: this.signupsService,
        settingsService: this.settingsService,
        notifications: this.notifications,
        lineupNotifications: this.lineupNotifications,
        logger: this.logger,
      },
      lockIn,
    );
  }

  /**
   * ROK-1370: lock-in cleared reschedulingPollId — re-emit UPDATED so the
   * embed resets RESCHEDULING → POSTED and the Scheduled Event is recreated
   * at the (already-moved) winning time. The caller skips an event cancelled
   * mid-poll: the re-emit would recreate a Discord SE for a dead event.
   */
  private async reemitLinkedEvent(linkedEventId: number): Promise<void> {
    this.eventsService
      .emitLifecycleEvent(linkedEventId, APP_EVENT_EVENTS.UPDATED)
      .catch(noop);
    // ROK-1392: the re-emit's embed re-render is fire-and-forget, so on a
    // quiet server the card could stay on RESCHEDULING. completeStandalonePoll
    // already cleared the flag; a level-triggered sync restores the embed.
    await this.embedSyncQueue.enqueue(linkedEventId, 'reschedule-poll-lockin');
  }
}
