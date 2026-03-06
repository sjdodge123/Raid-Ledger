import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
  findActiveScheduledEvent,
  extendScheduledEventWindow,
  autoSignupParticipant,
  recoverLiveEvents,
  getEventById,
  setEventEndTime,
  claimAndEndEvent,
} from './ad-hoc-event.helpers';
import {
  handleJoinExisting,
  spawnNewEvent,
  notifyCompleted,
  startGracePeriod,
  type ActiveAdHocState,
  type AdHocHandlerDeps,
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
  ) {}

  /** Recover any live ad-hoc events from the database on startup. */
  async onModuleInit(): Promise<void> {
    const liveEvents = await recoverLiveEvents(this.db);
    for (const event of liveEvents) {
      if (!event.channelBindingId) continue;
      const key = this.buildEventKey(event.channelBindingId, event.gameId);
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

  /** Handle a member joining a bound voice channel. */
  async handleVoiceJoin(
    bindingId: string,
    member: VoiceMemberInfo,
    binding: {
      gameId: number | null;
      config: {
        minPlayers?: number;
        gracePeriod?: number;
        notificationChannelId?: string;
      } | null;
    },
    resolvedGameId?: number | null,
    resolvedGameName?: string,
  ): Promise<void> {
    if (!(await this.isEnabled())) return;

    const effectiveGameId =
      resolvedGameId !== undefined ? resolvedGameId : binding.gameId;
    const eventKey = this.buildEventKey(bindingId, effectiveGameId);

    if (await this.tryJoinExisting(eventKey, bindingId, member)) return;
    if (await this.trySuppressForScheduled(bindingId, effectiveGameId)) return;

    await spawnNewEvent(
      this.getDeps(),
      eventKey,
      bindingId,
      { ...binding, gameId: effectiveGameId },
      effectiveGameId,
      member,
      resolvedGameName,
    );
  }

  /** Handle a member leaving a bound voice channel. */
  async handleVoiceLeave(
    bindingId: string,
    discordUserId: string,
    gameId?: number | null,
  ): Promise<void> {
    const eventKey = this.findEventKeyForMember(
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
    return this.activeEvents.get(this.buildEventKey(bindingId, gameId));
  }

  /** Check if any active event exists for a binding. */
  hasAnyActiveEvent(bindingId: string): boolean {
    for (const key of this.activeEvents.keys()) {
      if (key === bindingId || key.startsWith(`${bindingId}:`)) return true;
    }
    return false;
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

  private async trySuppressForScheduled(
    bindingId: string,
    effectiveGameId: number | null | undefined,
  ): Promise<boolean> {
    const now = new Date();
    const scheduled = await findActiveScheduledEvent(
      this.db,
      bindingId,
      effectiveGameId,
      now,
    );
    if (!scheduled) return false;
    await extendScheduledEventWindow(this.db, scheduled.id, null, now);
    return true;
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

  private buildEventKey(bindingId: string, gameId?: number | null): string {
    if (gameId !== undefined && gameId !== null)
      return `${bindingId}:${gameId}`;
    if (gameId === null) return `${bindingId}:null`;
    return bindingId;
  }

  private findEventKeyForMember(
    bindingId: string,
    discordUserId: string,
    gameId?: number | null,
  ): string | null {
    if (gameId !== undefined) {
      const key = this.buildEventKey(bindingId, gameId);
      if (this.activeEvents.has(key)) return key;
    }
    if (this.activeEvents.has(bindingId)) return bindingId;
    for (const [key, state] of this.activeEvents) {
      if (
        (key === bindingId || key.startsWith(`${bindingId}:`)) &&
        state.memberSet.has(discordUserId)
      )
        return key;
    }
    return null;
  }
}
