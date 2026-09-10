import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { SETTING_KEYS } from '../../drizzle/schema';
import { UsersService } from '../../users/users.service';
import {
  AdHocParticipantService,
  type VoiceMemberInfo,
} from './ad-hoc-participant.service';
import { AdHocNotificationService } from './ad-hoc-notification.service';
import { ChannelBindingsService } from './channel-bindings.service';
import { AdHocGracePeriodQueueService } from '../queues/ad-hoc-grace-period.queue';
import { AdHocEventsGateway } from '../../events/ad-hoc-events.gateway';
import { VoiceAttendanceService } from './voice-attendance.service';
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
import type { AdHocRosterResponseDto } from '@raid-ledger/contract';
import {
  autoSignupParticipant,
  recoverLiveEvents,
  getEventById,
  setEventEndTime,
  claimAndEndEvent,
} from './ad-hoc-event.helpers';
import {
  checkSuppression,
  resolveSpawnClearance,
  type SpawnClearance,
} from './ad-hoc-spawn-clearance';
import { traceGate } from '../listeners/voice-gate-trace';
import {
  buildEventKey,
  findEventKeyForMember,
} from './ad-hoc-event-key.helpers';
import { announceLfgSessionEnd } from '../lfg-now/lfg-now-session-end.helpers';
import {
  handleJoinExisting,
  spawnNewEvent,
  notifyCompleted,
  startGracePeriod,
  type ActiveAdHocState,
  type AdHocHandlerDeps,
  type VoiceJoinBinding,
} from './ad-hoc-event.handlers';

@Injectable()
export class AdHocEventService implements OnModuleInit {
  private readonly logger = new Logger(AdHocEventService.name);
  private activeEvents = new Map<string, ActiveAdHocState>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
    private readonly usersService: UsersService,
    private readonly participantService: AdHocParticipantService,
    private readonly notificationService: AdHocNotificationService,
    private readonly channelBindingsService: ChannelBindingsService,
    private readonly gracePeriodQueue: AdHocGracePeriodQueueService,
    private readonly gateway: AdHocEventsGateway,
    private readonly voiceAttendanceService: VoiceAttendanceService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // STARTUP-CRITICAL: Must recover live ad-hoc events to avoid orphaned voice sessions. @see bestEffortInit
  /** Recover any live ad-hoc events from the database on startup. */
  async onModuleInit(): Promise<void> {
    const liveEvents = await recoverLiveEvents(this.db);
    for (const event of liveEvents) {
      if (!event.channelBindingId) continue;
      const key = buildEventKey(event.channelBindingId, event.gameId);
      this.activeEvents.set(key, {
        eventId: event.id,
        memberSet: new Set(),
        gameId: event.gameId,
      });
    }
    if (liveEvents.length > 0) {
      this.logger.log(`Recovered ${liveEvents.length} live ad-hoc event(s)`);
    }
  }

  /** Check if ad-hoc events feature is enabled. */
  async isEnabled(): Promise<boolean> {
    const value = await this.settingsService.get(
      SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
    );
    return value === 'true';
  }

  /**
   * Handle a member joining a bound voice channel.
   *
   * `clearance` (ROK-1456) is the receipt `ensureNotSuppressed` minted when the
   * caller already ran the ROK-959 guard for this `(binding, game)`. It is the
   * guard's own output, not a caller assertion: omit it and the service runs
   * the guard itself; supply a stale/foreign/spent one and the service ignores
   * it and re-runs the guard. Nothing a caller passes can skip the check.
   */
  async handleVoiceJoin(
    bindingId: string,
    member: VoiceMemberInfo,
    binding: VoiceJoinBinding,
    resolvedGameId?: number | null,
    resolvedGameName?: string,
    channelId?: string,
    clearance?: SpawnClearance,
  ): Promise<boolean> {
    if (!(await this.isEnabled())) {
      // ROK-1417: the kill-switch is the single most common "why didn't Quick
      // Play spawn" cause — trace it (throttled per binding) so it's visible.
      traceGate(this.logger, 'feature-disabled', {
        channelId: channelId ?? 'unknown',
        bindingId,
        gameId: binding.gameId,
      });
      return false;
    }

    const effectiveGameId =
      resolvedGameId !== undefined ? resolvedGameId : binding.gameId;
    const eventKey = buildEventKey(bindingId, effectiveGameId);

    if (await this.tryJoinExisting(eventKey, bindingId, member)) return true;
    const cleared = await resolveSpawnClearance(
      this.db,
      bindingId,
      effectiveGameId,
      channelId,
      clearance,
    );
    if (!cleared) return false;

    await spawnNewEvent(
      this.getDeps(),
      cleared,
      eventKey,
      bindingId,
      { ...binding, gameId: effectiveGameId },
      effectiveGameId,
      member,
      resolvedGameName,
    );
    return true;
  }

  /**
   * ROK-959 / ROK-1456: the explicit suppression step every spawn path runs
   * exactly once. Returns `null` (and bound-extends the scheduled event's
   * `extended_until` window) when a live scheduled event suppresses ad-hoc
   * creation; otherwise the single-use `SpawnClearance` that `spawnNewEvent`
   * requires — hand it back to `handleVoiceJoin` to avoid a second guard run.
   */
  async ensureNotSuppressed(
    bindingId: string,
    effectiveGameId: number | null | undefined,
    channelId?: string,
  ): Promise<SpawnClearance | null> {
    return checkSuppression(this.db, bindingId, effectiveGameId, channelId);
  }

  /** Handle a member leaving a bound voice channel. */
  async handleVoiceLeave(
    bindingId: string,
    discordUserId: string,
    gameId?: number | null,
  ): Promise<void> {
    const eventKey = findEventKeyForMember(
      this.activeEvents,
      bindingId,
      discordUserId,
      gameId,
    );
    if (!eventKey) return;

    const state = this.activeEvents.get(eventKey);
    if (!state) return;

    state.memberSet.delete(discordUserId);
    this.voiceAttendanceService.handleLeave(state.eventId, discordUserId);

    const event = await getEventById(this.db, state.eventId);
    if (!event || event.adHocStatus === 'ended' || event.cancelledAt) {
      this.activeEvents.delete(eventKey);
      return;
    }

    await this.processLeave(state, event, discordUserId);
  }

  /** Finalize an ad-hoc event when grace period expires. */
  async finalizeEvent(eventId: number): Promise<void> {
    const now = new Date();
    const claimed = await claimAndEndEvent(this.db, eventId, now);
    if (!claimed) return;

    await this.participantService.finalizeAll(eventId);
    await setEventEndTime(this.db, eventId, claimed, now);
    await notifyCompleted(this.getDeps(), eventId, claimed, now);

    this.gateway.emitStatusChange(eventId, 'ended');
    // ROK-1505 AC10a: the ORDINARY end of a session, which before AC10
    // announced nothing — only the reaper's orphan path did. Same helper, so
    // an LFG-born session closes its `lfg_group_messages` row however it ends.
    await announceLfgSessionEnd(
      { db: this.db, eventEmitter: this.eventEmitter },
      eventId,
      this.logger,
    );
    this.removeActiveEvent(eventId);
    this.logger.log(`Ad-hoc event ${eventId} finalized (completed)`);
  }

  /** Get the ad-hoc roster for an event. */
  async getAdHocRoster(eventId: number): Promise<AdHocRosterResponseDto> {
    const participants = await this.participantService.getRoster(eventId);
    const activeCount = await this.participantService.getActiveCount(eventId);
    return { eventId, participants, activeCount };
  }

  /** Get active state for a binding. */
  getActiveState(
    bindingId: string,
    gameId?: number | null,
  ): ActiveAdHocState | undefined {
    return this.activeEvents.get(buildEventKey(bindingId, gameId));
  }

  /**
   * ROK-1394: find the binding's single active event regardless of game key.
   * Fixed-game binds hold ≤1 active event; the degrade path keys it under
   * `bindingId:null` while later joins resolve the sticky game, so a game-keyed
   * lookup misses it and mints a duplicate. Returns the event's gameId so the
   * caller can join with the matching key.
   */
  getActiveBindingEventGameId(
    bindingId: string,
  ): { gameId: number | null } | undefined {
    for (const [key, state] of this.activeEvents) {
      if (key === bindingId || key.startsWith(`${bindingId}:`)) {
        return { gameId: state.gameId ?? null };
      }
    }
    return undefined;
  }

  /** Check if any active event exists for a binding. */
  hasAnyActiveEvent(bindingId: string): boolean {
    return this.getActiveBindingEventGameId(bindingId) !== undefined;
  }

  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  async onEventCancelled(payload: {
    eventId: number;
    isAdHoc?: boolean;
  }): Promise<void> {
    if (!payload?.eventId) return;
    await this.removeAndCancel(payload.eventId);
  }

  @OnEvent(APP_EVENT_EVENTS.DELETED)
  async onEventDeleted(payload: { eventId: number }): Promise<void> {
    if (!payload?.eventId) return;
    await this.removeAndCancel(payload.eventId);
  }

  // ─── Private ──────────────────────────────────────────

  private getDeps(): AdHocHandlerDeps {
    return {
      db: this.db,
      participantService: this.participantService,
      notificationService: this.notificationService,
      voiceAttendanceService: this.voiceAttendanceService,
      gateway: this.gateway,
      gracePeriodQueue: this.gracePeriodQueue,
      channelBindingsService: this.channelBindingsService,
      activeEvents: this.activeEvents,
      autoSignupParticipant: (eventId, member) =>
        this.autoSignupParticipant(eventId, member),
    };
  }

  private async tryJoinExisting(
    eventKey: string,
    bindingId: string,
    member: VoiceMemberInfo,
  ): Promise<boolean> {
    const state = this.activeEvents.get(eventKey);
    if (!state) return false;
    return handleJoinExisting(
      this.getDeps(),
      state,
      eventKey,
      bindingId,
      member,
    );
  }

  private async processLeave(
    state: ActiveAdHocState,
    event: typeof schema.events.$inferSelect,
    discordUserId: string,
  ): Promise<void> {
    await this.participantService.markLeave(state.eventId, discordUserId);
    if (event.channelBindingId) {
      this.notificationService.queueUpdate(
        state.eventId,
        event.channelBindingId,
      );
    }
    const roster = await this.getAdHocRoster(state.eventId);
    this.gateway.emitRosterUpdate(
      state.eventId,
      roster.participants,
      roster.activeCount,
    );
    if (state.memberSet.size === 0) {
      await startGracePeriod(
        this.getDeps(),
        state.eventId,
        event.channelBindingId,
      );
    }
  }

  private async autoSignupParticipant(
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<void> {
    await autoSignupParticipant(this.db, eventId, member);
  }

  private async removeAndCancel(eventId: number): Promise<void> {
    for (const [key, state] of this.activeEvents) {
      if (state.eventId === eventId) {
        await this.gracePeriodQueue.cancel(state.eventId);
        this.activeEvents.delete(key);
        break;
      }
    }
  }

  private removeActiveEvent(eventId: number): void {
    for (const [key, s] of this.activeEvents) {
      if (s.eventId === eventId) {
        this.activeEvents.delete(key);
        break;
      }
    }
  }
}
