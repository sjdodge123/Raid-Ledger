import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
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
import type { AdHocRosterResponseDto } from '@raid-ledger/contract';

/** Minimum interval between end-time extensions (ms). */
const EXTEND_THROTTLE_MS = 5 * 60 * 1000;

/** Interval for periodic end-time extension checks (ms). */
const EXTEND_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** In-memory state for an active ad-hoc event. */
interface ActiveAdHocState {
  eventId: number;
  memberSet: Set<string>; // Discord user IDs currently in the channel
  lastExtendedAt: number; // epoch ms
}

@Injectable()
export class AdHocEventService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdHocEventService.name);

  /** Map of channelBindingId -> active ad-hoc state */
  private activeEvents = new Map<string, ActiveAdHocState>();

  /** Periodic timer for extending end times of occupied events. */
  private extendInterval: ReturnType<typeof setInterval> | null = null;

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
  ) {}

  /**
   * On startup, recover any live ad-hoc events from the database.
   */
  async onModuleInit(): Promise<void> {
    const liveEvents = await this.db
      .select()
      .from(schema.events)
      .where(
        and(
          eq(schema.events.isAdHoc, true),
          sql`${schema.events.adHocStatus} = 'live'`,
        ),
      );

    for (const event of liveEvents) {
      if (!event.channelBindingId) continue;

      this.activeEvents.set(event.channelBindingId, {
        eventId: event.id,
        memberSet: new Set(),
        lastExtendedAt: Date.now(),
      });

      this.logger.log(
        `Recovered live ad-hoc event ${event.id} for binding ${event.channelBindingId}`,
      );
    }

    if (liveEvents.length > 0) {
      this.logger.log(
        `Recovered ${liveEvents.length} live ad-hoc event(s) on startup`,
      );
    }

    this.startExtendInterval();
  }

  onModuleDestroy(): void {
    this.stopExtendInterval();
  }

  /**
   * Start the periodic interval that extends end times for occupied events.
   * AC-8: Event end time continuously extends while the channel is occupied.
   */
  private startExtendInterval(): void {
    this.stopExtendInterval();
    this.extendInterval = setInterval(() => {
      this.extendAllActiveEvents().catch((err) => {
        this.logger.error(`Periodic end-time extension failed: ${err}`);
      });
    }, EXTEND_CHECK_INTERVAL_MS);
  }

  private stopExtendInterval(): void {
    if (this.extendInterval) {
      clearInterval(this.extendInterval);
      this.extendInterval = null;
    }
  }

  /**
   * Extend end times for all active events that still have members.
   */
  private async extendAllActiveEvents(): Promise<void> {
    for (const [bindingId, state] of this.activeEvents) {
      if (state.memberSet.size > 0) {
        await this.maybeExtendEndTime(state);
      }
    }
  }

  /**
   * Check if ad-hoc events feature is enabled.
   */
  async isEnabled(): Promise<boolean> {
    const value = await this.settingsService.get(
      SETTING_KEYS.AD_HOC_EVENTS_ENABLED,
    );
    return value === 'true';
  }

  /**
   * Handle a member joining a bound voice channel.
   */
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
  ): Promise<void> {
    const enabled = await this.isEnabled();
    if (!enabled) return;

    const state = this.activeEvents.get(bindingId);

    if (state) {
      // AC-11: Add to existing live event
      state.memberSet.add(member.discordUserId);

      // Cancel any pending grace period
      await this.gracePeriodQueue.cancel(state.eventId);

      // Update event status back to live if in grace_period
      const [updated] = await this.db
        .update(schema.events)
        .set({ adHocStatus: 'live', updatedAt: new Date() })
        .where(
          and(
            eq(schema.events.id, state.eventId),
            sql`${schema.events.adHocStatus} = 'grace_period'`,
          ),
        )
        .returning({ id: schema.events.id });

      if (updated) {
        this.gateway.emitStatusChange(state.eventId, 'live');
      }

      // Add participant to roster
      await this.participantService.addParticipant(state.eventId, member);

      // Notify Discord embed + WebSocket clients
      this.notificationService.queueUpdate(state.eventId, bindingId);
      await this.emitRosterToClients(state.eventId);

      // Extend end time if throttle elapsed
      await this.maybeExtendEndTime(state);

      return;
    }

    // No active event — check if we should create one
    // Track this member temporarily to count
    const tempMembers = new Set<string>();
    tempMembers.add(member.discordUserId);

    // We need to check if this single join meets threshold
    // The caller (VoiceStateListener) tracks cumulative members
    // For now, always create when first join triggers this method
    // The listener handles threshold checking before calling us

    // Create a new ad-hoc event
    const eventId = await this.createAdHocEvent(bindingId, binding, member);
    if (!eventId) return;

    this.activeEvents.set(bindingId, {
      eventId,
      memberSet: tempMembers,
      lastExtendedAt: Date.now(),
    });

    // Add the first participant
    await this.participantService.addParticipant(eventId, member);

    // Notify Discord embed (spawn) + WebSocket clients
    const event = await this.getEvent(eventId);
    if (event) {
      let gameName: string | undefined;
      if (binding.gameId) {
        const [game] = await this.db
          .select({ name: schema.games.name })
          .from(schema.games)
          .where(eq(schema.games.id, binding.gameId))
          .limit(1);
        if (game) gameName = game.name;
      }

      await this.notificationService.notifySpawn(
        eventId,
        bindingId,
        {
          id: eventId,
          title: event.title,
          gameName,
        },
        [
          {
            discordUserId: member.discordUserId,
            discordUsername: member.discordUsername,
          },
        ],
      );
    }

    this.gateway.emitStatusChange(eventId, 'live');
    await this.emitRosterToClients(eventId);

    this.logger.log(`Ad-hoc event ${eventId} created for binding ${bindingId}`);
  }

  /**
   * Handle a member leaving a bound voice channel.
   */
  async handleVoiceLeave(
    bindingId: string,
    discordUserId: string,
  ): Promise<void> {
    const state = this.activeEvents.get(bindingId);
    if (!state) return;

    state.memberSet.delete(discordUserId);

    // Mark participant as left
    await this.participantService.markLeave(state.eventId, discordUserId);

    // Notify Discord embed + WebSocket clients
    const event = await this.getEvent(state.eventId);
    if (event?.channelBindingId) {
      this.notificationService.queueUpdate(
        state.eventId,
        event.channelBindingId,
      );
    }
    await this.emitRosterToClients(state.eventId);

    if (state.memberSet.size === 0) {
      // All members gone — start grace period
      if (!event) return;

      const binding = event.channelBindingId
        ? await this.channelBindingsService.getBindingById(
            event.channelBindingId,
          )
        : null;

      const gracePeriod =
        (binding?.config as { gracePeriod?: number } | null)?.gracePeriod ?? 5;
      const gracePeriodMs = gracePeriod * 60 * 1000;

      // Update status to grace_period
      await this.db
        .update(schema.events)
        .set({ adHocStatus: 'grace_period', updatedAt: new Date() })
        .where(eq(schema.events.id, state.eventId));

      // Enqueue finalization
      await this.gracePeriodQueue.enqueue(state.eventId, gracePeriodMs);

      // Notify WebSocket clients of status change
      this.gateway.emitStatusChange(state.eventId, 'grace_period');

      this.logger.log(
        `Ad-hoc event ${state.eventId} entered grace period (${gracePeriod} min)`,
      );
    }
  }

  /**
   * Finalize an ad-hoc event — called when grace period expires.
   */
  async finalizeEvent(eventId: number): Promise<void> {
    // Check the event still exists and is in grace_period
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event || event.adHocStatus !== 'grace_period') {
      this.logger.debug(
        `Skipping finalization for event ${eventId} (status: ${event?.adHocStatus})`,
      );
      return;
    }

    // Finalize all participants
    await this.participantService.finalizeAll(eventId);

    // Update event status
    const now = new Date();
    await this.db
      .update(schema.events)
      .set({
        adHocStatus: 'ended',
        // Set the end time to now
        duration: [event.duration[0], now] as [Date, Date],
        updatedAt: now,
      })
      .where(eq(schema.events.id, eventId));

    // Notify Discord embed (completed) + WebSocket clients
    if (event.channelBindingId) {
      let gameName: string | undefined;
      if (event.gameId) {
        const [game] = await this.db
          .select({ name: schema.games.name })
          .from(schema.games)
          .where(eq(schema.games.id, event.gameId))
          .limit(1);
        if (game) gameName = game.name;
      }

      const participants = await this.participantService.getRoster(eventId);
      await this.notificationService.notifyCompleted(
        eventId,
        event.channelBindingId,
        {
          id: eventId,
          title: event.title,
          gameName,
          startTime: event.duration[0].toISOString(),
          endTime: now.toISOString(),
        },
        participants.map((p) => ({
          discordUserId: p.discordUserId,
          discordUsername: p.discordUsername,
          totalDurationSeconds: p.totalDurationSeconds,
        })),
      );
    }

    this.gateway.emitStatusChange(eventId, 'ended');

    // Remove from active events map
    if (event.channelBindingId) {
      this.activeEvents.delete(event.channelBindingId);
    }

    this.logger.log(`Ad-hoc event ${eventId} finalized (completed)`);
  }

  /**
   * Get the ad-hoc roster for an event.
   */
  async getAdHocRoster(eventId: number): Promise<AdHocRosterResponseDto> {
    const participants = await this.participantService.getRoster(eventId);
    const activeCount = await this.participantService.getActiveCount(eventId);

    return {
      eventId,
      participants,
      activeCount,
    };
  }

  /**
   * Get active state for a binding (used by VoiceStateListener).
   */
  getActiveState(bindingId: string): ActiveAdHocState | undefined {
    return this.activeEvents.get(bindingId);
  }

  /**
   * Create a new ad-hoc event in the database.
   */
  private async createAdHocEvent(
    bindingId: string,
    binding: {
      gameId: number | null;
      config: {
        minPlayers?: number;
        gracePeriod?: number;
        notificationChannelId?: string;
      } | null;
    },
    triggerMember: VoiceMemberInfo,
  ): Promise<number | null> {
    // Determine creator — linked user or fallback
    let creatorId = triggerMember.userId;

    if (!creatorId) {
      // Fallback: find any admin user
      const [admin] = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(eq(schema.users.role, 'admin'))
        .limit(1);

      if (!admin) {
        this.logger.error(
          'Cannot create ad-hoc event: no linked user or admin found',
        );
        return null;
      }
      creatorId = admin.id;
    }

    // Build title
    let gameName = 'Gaming';
    if (binding.gameId) {
      const [game] = await this.db
        .select({ name: schema.games.name })
        .from(schema.games)
        .where(eq(schema.games.id, binding.gameId))
        .limit(1);
      if (game) gameName = game.name;
    }
    const title = `${gameName} — Ad-Hoc Session`;

    const now = new Date();
    // Initial end time: 1 hour from now (will be extended)
    const endTime = new Date(now.getTime() + 60 * 60 * 1000);

    const [event] = await this.db
      .insert(schema.events)
      .values({
        title,
        gameId: binding.gameId,
        creatorId,
        duration: [now, endTime],
        slotConfig: { type: 'generic' },
        maxAttendees: null,
        isAdHoc: true,
        adHocStatus: 'live',
        channelBindingId: bindingId,
        // Disable all reminders for ad-hoc events
        reminder15min: false,
        reminder1hour: false,
        reminder24hour: false,
      })
      .returning();

    return event.id;
  }

  /**
   * Extend the end time if the throttle interval has elapsed.
   */
  private async maybeExtendEndTime(state: ActiveAdHocState): Promise<void> {
    const now = Date.now();
    if (now - state.lastExtendedAt < EXTEND_THROTTLE_MS) return;

    state.lastExtendedAt = now;

    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, state.eventId))
      .limit(1);

    if (!event) return;

    // Extend end time to 1 hour from now
    const newEnd = new Date(now + 60 * 60 * 1000);
    await this.db
      .update(schema.events)
      .set({
        duration: [event.duration[0], newEnd] as [Date, Date],
        updatedAt: new Date(),
      })
      .where(eq(schema.events.id, state.eventId));

    this.gateway.emitEndTimeExtended(state.eventId, newEnd.toISOString());

    this.logger.debug(`Extended end time for ad-hoc event ${state.eventId}`);
  }

  /**
   * Emit current roster to WebSocket clients.
   */
  private async emitRosterToClients(eventId: number): Promise<void> {
    const roster = await this.getAdHocRoster(eventId);
    this.gateway.emitRosterUpdate(
      eventId,
      roster.participants,
      roster.activeCount,
    );
  }

  /**
   * Get an event by ID.
   */
  private async getEvent(
    eventId: number,
  ): Promise<typeof schema.events.$inferSelect | null> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    return event ?? null;
  }
}
