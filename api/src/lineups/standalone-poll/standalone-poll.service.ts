/**
 * Service for standalone scheduling polls (ROK-977).
 * Creates a minimal lineup (decided) + match (scheduling) behind the scenes,
 * exposing a simplified API that skips the full lineup flow.
 */
import {
  Inject,
  Injectable,
  Logger,
  ConflictException,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { GameActivityNudge } from '../../discord-bot/channel-lifecycle/channel-lifecycle.nudge';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  SchedulingPollResponseDto,
  StandalonePollVisibility,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { LineupPhaseQueueService } from '../queue/lineup-phase.queue';
import { scheduleTransitionBestEffort } from '../queue/lineup-phase-schedule.helpers';
import { StandalonePollNotificationService } from './standalone-poll-notification.service';
import { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import {
  requirePollGame,
  filterValidUserIds,
  insertDecidedLineup,
  insertSchedulingMatch,
  insertMatchMembers,
  countMatchMembers,
  countActiveEventSignups,
  findActiveStandalonePolls,
  completeStandalonePoll,
  stampReschedulingPollId,
} from './standalone-poll-query.helpers';
import { assertCanRescheduleEvent } from './standalone-poll-auth.helpers';
import { SignupsService } from '../../events/signups.service';
import { EventsService } from '../../events/events.service';
import { APP_EVENT_EVENTS } from '../../discord-bot/discord-bot.constants';
import { SettingsService } from '../../settings/settings.service';
import {
  assertVisibilityAllowed,
  buildShareSettings,
} from './standalone-poll-share.helpers';
import { fireCreateFanout } from './standalone-poll-create-fanout.helpers';
import { insertInvitees } from './standalone-poll-share-query.helpers';
import { resolvePollHubId } from './standalone-poll-hub.helpers';
import { runLockInFanout, type LockIn } from './standalone-poll-lockin.helpers';
import { assertCanCompleteWithBench } from './standalone-poll-bench-pick.helpers';
import { LineupNotificationService } from '../lineup-notification.service';
import { EmbedSyncQueueService } from '../../discord-bot/queues/embed-sync.queue';

/** No-op rejection swallower for fire-and-forget DMs. */
const noop = (): void => {};

/** Input DTO after Zod validation. */
export interface CreatePollInput {
  gameId: number;
  linkedEventId?: number;
  durationHours?: number;
  memberUserIds?: number[];
  /** Minimum unique voters before organizer is notified (ROK-1015). */
  minVoteThreshold?: number;
  hubId?: number; // ROK-1893 P3: hub tag (exclusive with linkedEventId)
  /**
   * ROK-1371: user IDs to EXCLUDE from the game-interest broadcast because they
   * are already receiving the targeted post-event follow-up DM. Internal-only
   * (not on the public Zod schema) so regular polls never set it → no-op.
   */
  broadcastExcludeUserIds?: number[];
  /** ROK-1750: `private` = picked members + link holders only. */
  visibility?: StandalonePollVisibility;
}

type ShareSettings = ReturnType<typeof buildShareSettings>;
export type PollGame = {
  id: number;
  name: string;
  coverUrl: string | null;
};

/**
 * Fallback poll length when the caller omits `durationHours` (2 weeks).
 *
 * A null `phase_deadline` opted the poll out of BOTH the deadline reminder
 * service and the auto-archive job, so deadline-less polls stayed open
 * forever with no way to close but a manual lock-in. Every poll now gets a
 * deadline; two weeks is long enough not to guillotine a slow-moving group.
 * Stays within the contract's 1-720h bound.
 */
const DEFAULT_POLL_DURATION_HOURS = 14 * 24;

@Injectable()
export class StandalonePollService {
  private readonly logger = new Logger(StandalonePollService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly phaseQueue: LineupPhaseQueueService,
    private readonly notifications: StandalonePollNotificationService,
    private readonly schedulingPollEmbed: SchedulingPollEmbedService,
    private readonly signupsService: SignupsService,
    private readonly settingsService: SettingsService,
    private readonly eventsService: EventsService,
    @Inject(forwardRef(() => EmbedSyncQueueService))
    private readonly embedSyncQueue: EmbedSyncQueueService,
    private readonly lineupNotifications: LineupNotificationService,
    @Optional() private readonly nudge?: GameActivityNudge,
  ) {}

  /** List the active standalone polls the caller may see (ROK-1750). */
  async listActive(caller: { id: number; isAdmin: boolean }) {
    return findActiveStandalonePolls(this.db, caller);
  }

  /** Mark a poll as completed (match -> scheduled; a standalone lineup ->
   *  archived, a regular lineup match -> linked to the event — ROK-2024).
   *  When eventId is provided, resolves only after the slot voters' signups
   *  (ROK-1031/2031); heart, DMs and EVENT CREATED (skipped for a reschedule)
   *  follow without being awaited.
   *  ROK-2025: `benchUserIds` = the organizer's bench pick, checked before
   *  the flip so a 400 leaves the poll open for a retry. */
  async complete(
    matchId: number,
    eventId?: number,
    startTime?: string,
    creatorId?: number,
    isAdmin = false,
    benchUserIds?: number[],
  ): Promise<boolean> {
    // ROK-1370 (P2): a LINKED poll's lock-in re-emits UPDATED (embed → POSTED,
    // SE recreated) — restrict it to the poll/event owner or an admin.
    // ROK-1844: every completion is owner/staff-only, and `eventId` must be
    // the caller's and come from this poll — checked before anything changes.
    const bench = await assertCanCompleteWithBench(
      this.db,
      { id: creatorId ?? -1, isAdmin },
      { matchId, eventId, startTime, benchUserIds },
    );
    const result = await completeStandalonePoll(
      this.db,
      matchId,
      eventId,
      startTime,
    );
    if (result.conflict) {
      throw new ConflictException('This poll has already been completed');
    }
    if (result.ok) {
      await this.afterLockIn(
        result,
        matchId,
        eventId,
        startTime,
        creatorId,
        bench,
      );
    }
    return result.ok;
  }

  /** Side effects of a successful `complete()`. */
  private async afterLockIn(
    result: Awaited<ReturnType<typeof completeStandalonePoll>>,
    matchId: number,
    eventId: number | undefined,
    startTime: string | undefined,
    creatorId: number | undefined,
    benchUserIds?: ReadonlySet<number>,
  ): Promise<void> {
    // ROK-1461: lock-in flips the match to `scheduled` — re-render the poll
    // embed so its author line and colour follow.
    this.schedulingPollEmbed.fireUpdateEmbed(matchId);
    // The contract requires `startTime` with `eventId`; only that slot's
    // yes-voters are signed up (ROK-1844), never every yes-voter.
    // ROK-2024: announce once, after those signups, and never for a
    // reschedule (`linkedEventId`) — its event was announced when created.
    // ROK-2031: awaited, so the roster is populated when `complete` returns.
    if (eventId && startTime) {
      await this.startLockInFanout({
        matchId,
        eventId,
        startTime,
        creatorId,
        announce: !result.linkedEventId,
        benchUserIds,
      });
    }
    if (result.linkedEventId && !result.linkedEventCancelled) {
      await this.reemitLinkedEvent(result.linkedEventId);
    }
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
    // ROK-1392: the UPDATED re-emit recreates the Scheduled Event, but its
    // embed re-render is fire-and-forget — on a quiet server nothing else
    // enqueues an embed sync, so the card can stay stuck on RESCHEDULING
    // until unrelated traffic heals it. completeStandalonePoll has already
    // cleared reschedulingPollId, so enqueue an explicit level-triggered
    // sync now: the processor reads the (cleared) flag and restores the live
    // embed deterministically. Symmetric to the poll-start RESCHEDULING
    // teardown's updateEmbedState.
    await this.embedSyncQueue.enqueue(linkedEventId, 'reschedule-poll-lockin');
  }

  /**
   * Create a standalone scheduling poll.
   * Inserts a decided lineup + scheduling match, adds members,
   * optionally schedules auto-archive, and notifies interested users.
   */
  async create(
    input: CreatePollInput,
    userId: number,
    isAdmin = false,
  ): Promise<SchedulingPollResponseDto> {
    assertVisibilityAllowed(input.visibility, input.linkedEventId);
    const share = buildShareSettings(input.visibility);
    const game = await requirePollGame(this.db, input.gameId);
    if (input.linkedEventId) {
      // ROK-1370 (P1): opening a poll linked to an event is destructive — only
      // the event owner or an admin may do it (404 preserved when missing).
      await assertCanRescheduleEvent(
        this.db,
        input.linkedEventId,
        userId,
        isAdmin,
      );
    }
    const hubId = await resolvePollHubId(this.db, input, userId, isAdmin);
    const phaseDeadline = this.computeDeadline(input.durationHours);
    const lineup = await insertDecidedLineup(
      this.db,
      userId,
      input.linkedEventId,
      phaseDeadline,
      share,
      hubId,
    );
    const match = await insertSchedulingMatch(
      this.db,
      lineup.id,
      input.gameId,
      input.linkedEventId,
      await this.resolveMinVoteThreshold(input),
    );
    if (input.linkedEventId) {
      await this.linkEventToPoll(input.linkedEventId, match.id);
    }
    const pickedIds = await this.addMembers(
      match.id,
      userId,
      input.memberUserIds,
    );
    if (share.visibility === 'private') {
      // ROK-1750 (D4): picked members are invitees too, so the private
      // lineup's view / vote guards admit them.
      const invitees = pickedIds.filter((id) => id !== userId);
      await insertInvitees(this.db, lineup.id, invitees, userId);
    }
    // Always set: computeDeadline falls back to DEFAULT_POLL_DURATION_HOURS.
    // ROK-1512: best-effort — the poll row committed; `reconcileArchiveJobs`
    // heals a missing archive job at boot and Sentry has the failure.
    await scheduleTransitionBestEffort(
      this.phaseQueue,
      lineup.id,
      'archived',
      phaseDeadline.getTime() - Date.now(),
      'StandalonePollService.create',
    );
    fireCreateFanout(
      {
        notifications: this.notifications,
        pollEmbed: this.schedulingPollEmbed,
        nudge: this.nudge,
      },
      game,
      { lineupId: lineup.id, matchId: match.id, creatorId: userId },
      input,
      pickedIds,
      share.visibility,
      hubId,
    );
    const memberCount = await countMatchMembers(this.db, match.id);
    return this.buildResponse(match.id, lineup.id, game, memberCount, share);
  }

  /**
   * Resolve the vote threshold for a new poll. Linked (reschedule) polls
   * default to the linked event's active roster size — the ROK-1015
   * ready-for-review cron only considers polls with a non-null threshold, so
   * a NULL default meant the creator was never notified. Explicit input
   * always wins; an empty roster keeps null (nothing meaningful to wait for).
   */
  private async resolveMinVoteThreshold(
    input: CreatePollInput,
  ): Promise<number | undefined> {
    if (input.minVoteThreshold !== undefined || !input.linkedEventId) {
      return input.minVoteThreshold;
    }
    const count = await countActiveEventSignups(this.db, input.linkedEventId);
    return count > 0 ? count : undefined;
  }

  /** Compute phase deadline from durationHours, defaulting to 2 weeks. */
  private computeDeadline(durationHours?: number): Date {
    const hours = durationHours || DEFAULT_POLL_DURATION_HOURS;
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  /** Add creator + provided members to the match; returns the valid picks. */
  private async addMembers(
    matchId: number,
    creatorId: number,
    memberUserIds?: number[],
  ): Promise<number[]> {
    const validIds = memberUserIds?.length
      ? await filterValidUserIds(this.db, memberUserIds)
      : [];
    const allIds = [creatorId, ...validIds];
    await insertMatchMembers(this.db, matchId, allIds);
    return validIds;
  }

  /** Atomically set reschedulingPollId on the linked event. */
  private async linkEventToPoll(
    eventId: number,
    matchId: number,
  ): Promise<void> {
    const stamped = await stampReschedulingPollId(this.db, eventId, matchId);
    if (!stamped) {
      throw new ConflictException(
        'Event is already being rescheduled or has been cancelled.',
      );
    }
    // ROK-1370 (Option A): flip the Discord embed to RESCHEDULING and tear down
    // the Scheduled Event now — lock-in recreates it at the winning time.
    this.eventsService
      .emitLifecycleEvent(eventId, APP_EVENT_EVENTS.RESCHEDULING)
      .catch(noop);
  }

  /** Build the API response DTO. */
  private buildResponse(
    matchId: number,
    lineupId: number,
    game: PollGame,
    memberCount: number,
    share: ShareSettings,
  ): SchedulingPollResponseDto {
    return {
      id: matchId,
      lineupId,
      gameId: game.id,
      gameName: game.name,
      gameCoverUrl: game.coverUrl,
      memberCount,
      status: 'scheduling',
      createdAt: new Date().toISOString(),
      visibility: share.visibility,
      shareToken: share.shareToken,
    };
  }
}
