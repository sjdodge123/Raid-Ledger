import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
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
import { APP_EVENT_EVENTS } from '../discord-bot.constants';
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
  gameId?: number | null; // For general-lobby composite key recovery
}

@Injectable()
export class AdHocEventService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdHocEventService.name);

  /**
   * Map of active event key -> state.
   * Key format:
   * - Game-specific bindings: `{bindingId}`
   * - General-lobby bindings: `{bindingId}:{gameId}` (composite key)
   *   This allows multiple concurrent events per general-lobby channel.
   */
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
          sql`${schema.events.cancelledAt} IS NULL`,
        ),
      );

    for (const event of liveEvents) {
      if (!event.channelBindingId) continue;

      // Check if this binding is a general-lobby (has gameId on the event)
      // to reconstruct the composite key
      const key = this.buildEventKey(event.channelBindingId, event.gameId);

      this.activeEvents.set(key, {
        eventId: event.id,
        memberSet: new Set(),
        lastExtendedAt: Date.now(),
        gameId: event.gameId,
      });

      this.logger.log(`Recovered live ad-hoc event ${event.id} for key ${key}`);
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
    for (const [, state] of this.activeEvents) {
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
   * For general-lobby bindings, resolvedGameId/resolvedGameName are provided
   * by the VoiceStateListener after presence detection.
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
    resolvedGameId?: number | null,
    resolvedGameName?: string,
  ): Promise<void> {
    const enabled = await this.isEnabled();
    if (!enabled) {
      this.logger.debug('handleVoiceJoin: ad-hoc events DISABLED, skipping');
      return;
    }

    this.logger.debug(
      `handleVoiceJoin: bindingId=${bindingId} user=${member.discordUserId} resolvedGameId=${resolvedGameId} resolvedGameName=${resolvedGameName}`,
    );

    // For general-lobby, use resolved game; for game-specific, use binding game
    const effectiveGameId =
      resolvedGameId !== undefined ? resolvedGameId : binding.gameId;
    const effectiveBinding = { ...binding, gameId: effectiveGameId };

    const eventKey = this.buildEventKey(bindingId, effectiveGameId);
    const state = this.activeEvents.get(eventKey);

    if (state) {
      // Verify event still exists and is active in DB (may have been
      // cancelled or ended externally while in-memory state was stale)
      const existing = await this.getEvent(state.eventId);
      if (
        !existing ||
        existing.adHocStatus === 'ended' ||
        existing.cancelledAt
      ) {
        this.activeEvents.delete(eventKey);
        this.logger.warn(
          `Removed stale active state for event ${state.eventId} (status: ${existing?.adHocStatus ?? 'deleted'})`,
        );
        // Fall through to create a new event below
      } else {
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

        // Add participant to roster + auto-signup for slot grid
        await this.participantService.addParticipant(state.eventId, member);
        await this.autoSignupParticipant(state.eventId, member);

        // Notify Discord embed + WebSocket clients
        this.notificationService.queueUpdate(state.eventId, bindingId);
        await this.emitRosterToClients(state.eventId);

        // Extend end time if throttle elapsed
        await this.maybeExtendEndTime(state);

        return;
      }
    }

    // No active ad-hoc event — check if we should create one

    // Suppress if a scheduled (non-ad-hoc) event for the same game is currently
    // active. Scheduled events don't have channelBindingId set, so match on
    // gameId instead. Also extend the scheduled event's end time if members
    // are still in the channel, preventing it from expiring and triggering an
    // ad-hoc spawn.
    const now = new Date();
    const lookbackMs = 30 * 60 * 1000; // 30 min — catch events that just ended
    const lookbackTime = new Date(now.getTime() - lookbackMs);

    const [activeScheduled] = await this.db
      .select({
        id: schema.events.id,
        duration: schema.events.duration,
      })
      .from(schema.events)
      .where(
        and(
          // Match by binding (ad-hoc→ad-hoc) OR by game (scheduled events)
          effectiveGameId
            ? sql`(${schema.events.channelBindingId} = ${bindingId} OR ${schema.events.gameId} = ${effectiveGameId})`
            : eq(schema.events.channelBindingId, bindingId),
          eq(schema.events.isAdHoc, false),
          sql`${schema.events.cancelledAt} IS NULL`,
          // Match if: event is currently active OR ended within last 30 min
          sql`lower(${schema.events.duration}) <= ${now.toISOString()}::timestamptz`,
          sql`upper(${schema.events.duration}) >= ${lookbackTime.toISOString()}::timestamptz`,
        ),
      )
      .limit(1);

    if (activeScheduled) {
      // Extend the scheduled event's end time by 1 hour from now
      // so it doesn't expire while members are still in the channel
      const newEnd = new Date(now.getTime() + 60 * 60 * 1000);
      const currentEnd = activeScheduled.duration?.[1];

      if (!currentEnd || currentEnd < newEnd) {
        await this.db
          .update(schema.events)
          .set({
            duration: [activeScheduled.duration[0], newEnd] as [Date, Date],
            updatedAt: now,
          })
          .where(eq(schema.events.id, activeScheduled.id));

        this.logger.debug(
          `Extended scheduled event ${activeScheduled.id} end time to ${newEnd.toISOString()} (members still in voice)`,
        );
      }

      return;
    }

    // Track this member temporarily to count
    const tempMembers = new Set<string>();
    tempMembers.add(member.discordUserId);

    // Create a new ad-hoc event — use resolved game name for title if available
    const eventId = await this.createAdHocEvent(
      bindingId,
      effectiveBinding,
      member,
      resolvedGameName,
    );
    if (!eventId) return;

    this.activeEvents.set(eventKey, {
      eventId,
      memberSet: tempMembers,
      lastExtendedAt: Date.now(),
      gameId: effectiveGameId,
    });

    // Add the first participant + auto-signup for slot grid
    await this.participantService.addParticipant(eventId, member);
    await this.autoSignupParticipant(eventId, member);

    // Notify Discord embed (spawn) + WebSocket clients
    const event = await this.getEvent(eventId);
    if (event) {
      let gameName: string | undefined = resolvedGameName;
      if (!gameName && effectiveGameId) {
        const [game] = await this.db
          .select({ name: schema.games.name })
          .from(schema.games)
          .where(eq(schema.games.id, effectiveGameId))
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

    this.logger.log(`Ad-hoc event ${eventId} created for key ${eventKey}`);
  }

  /**
   * Handle a member leaving a bound voice channel.
   * For general-lobby bindings, gameId is used to find the correct active event.
   * If gameId is not provided, searches all active events for the binding.
   */
  async handleVoiceLeave(
    bindingId: string,
    discordUserId: string,
    gameId?: number | null,
  ): Promise<void> {
    // Find the correct event key — for general lobby, try composite first
    const eventKey = this.findEventKeyForMember(
      bindingId,
      discordUserId,
      gameId,
    );
    if (!eventKey) return;

    const state = this.activeEvents.get(eventKey);
    if (!state) return;

    state.memberSet.delete(discordUserId);

    // Verify event still exists and is active
    const event = await this.getEvent(state.eventId);
    if (!event || event.adHocStatus === 'ended' || event.cancelledAt) {
      this.activeEvents.delete(eventKey);
      this.logger.warn(
        `Removed stale active state on leave for event ${state.eventId}`,
      );
      return;
    }

    // Mark participant as left
    await this.participantService.markLeave(state.eventId, discordUserId);

    // Notify Discord embed + WebSocket clients
    if (event.channelBindingId) {
      this.notificationService.queueUpdate(
        state.eventId,
        event.channelBindingId,
      );
    }
    await this.emitRosterToClients(state.eventId);

    if (state.memberSet.size === 0) {
      // All members gone — start grace period
      const binding = event.channelBindingId
        ? await this.channelBindingsService.getBindingById(
            event.channelBindingId,
          )
        : null;

      const rawGracePeriod =
        (binding?.config as { gracePeriod?: number } | null)?.gracePeriod ?? 5;
      const gracePeriod = Math.max(1, rawGracePeriod);
      const gracePeriodMs = gracePeriod * 60 * 1000;

      // Enqueue finalization FIRST — if this fails, status stays live
      await this.gracePeriodQueue.enqueue(state.eventId, gracePeriodMs);

      // Enqueue succeeded — update status to grace_period
      await this.db
        .update(schema.events)
        .set({ adHocStatus: 'grace_period', updatedAt: new Date() })
        .where(eq(schema.events.id, state.eventId));

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
    // Atomically claim the event for finalization — only proceeds if still in grace_period.
    // Prevents race condition where a rejoin updates status to 'live' concurrently.
    const now = new Date();

    const [claimed] = await this.db
      .update(schema.events)
      .set({
        adHocStatus: 'ended',
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.events.id, eventId),
          sql`${schema.events.adHocStatus} = 'grace_period'`,
        ),
      )
      .returning();

    if (!claimed) {
      this.logger.debug(
        `Skipping finalization for event ${eventId} (not in grace_period or already claimed)`,
      );
      return;
    }

    const event = claimed;

    // Finalize all participants
    await this.participantService.finalizeAll(eventId);

    // Set the end time to now
    await this.db
      .update(schema.events)
      .set({
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

    // Remove from active events map — scan for this eventId
    // since we may have composite keys for general-lobby events
    for (const [key, s] of this.activeEvents) {
      if (s.eventId === eventId) {
        this.activeEvents.delete(key);
        break;
      }
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
   * For game-specific bindings, uses bindingId as key.
   * For general-lobby bindings, pass gameId to construct composite key.
   */
  getActiveState(
    bindingId: string,
    gameId?: number | null,
  ): ActiveAdHocState | undefined {
    const key = this.buildEventKey(bindingId, gameId);
    return this.activeEvents.get(key);
  }

  /**
   * Check if any active event exists for a binding (any game).
   * Used by VoiceStateListener to check if the channel has any active events.
   */
  hasAnyActiveEvent(bindingId: string): boolean {
    for (const key of this.activeEvents.keys()) {
      if (key === bindingId || key.startsWith(`${bindingId}:`)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clean up active state when an ad-hoc event is cancelled via the UI.
   * This allows a new ad-hoc event to spawn on the same binding.
   */
  @OnEvent(APP_EVENT_EVENTS.CANCELLED)
  async onEventCancelled(payload: {
    eventId: number;
    isAdHoc?: boolean;
  }): Promise<void> {
    if (!payload?.eventId) return;

    for (const [bindingId, state] of this.activeEvents) {
      if (state.eventId === payload.eventId) {
        await this.gracePeriodQueue.cancel(state.eventId);
        this.activeEvents.delete(bindingId);
        this.logger.log(
          `Cleaned up active state for cancelled ad-hoc event ${payload.eventId} (binding ${bindingId})`,
        );
        break;
      }
    }
  }

  /**
   * Clean up active state when an ad-hoc event is deleted.
   */
  @OnEvent(APP_EVENT_EVENTS.DELETED)
  async onEventDeleted(payload: { eventId: number }): Promise<void> {
    if (!payload?.eventId) return;

    for (const [bindingId, state] of this.activeEvents) {
      if (state.eventId === payload.eventId) {
        await this.gracePeriodQueue.cancel(state.eventId);
        this.activeEvents.delete(bindingId);
        this.logger.log(
          `Cleaned up active state for deleted event ${payload.eventId} (binding ${bindingId})`,
        );
        break;
      }
    }
  }

  /**
   * Create a new ad-hoc event in the database.
   * resolvedGameName is used for general-lobby events where the game was
   * detected from presence rather than from the binding.
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
    resolvedGameName?: string,
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

    // Build title — prefer resolved game name (from presence detection)
    let gameName = resolvedGameName ?? 'Gaming';
    if (!resolvedGameName && binding.gameId) {
      const [game] = await this.db
        .select({ name: schema.games.name })
        .from(schema.games)
        .where(eq(schema.games.id, binding.gameId))
        .limit(1);
      if (game) gameName = game.name;
    }
    const title = `${gameName} — Quick Play`;

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
        slotConfig: { type: 'generic', player: 25, bench: 10 },
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
   * Auto-create an event signup and roster slot assignment for an ad-hoc
   * voice participant. This bridges ad-hoc participants into the regular
   * roster system so they appear in the PLAYERS slot grid.
   *
   * Idempotent: skips if the participant already has a signup for this event.
   */
  private async autoSignupParticipant(
    eventId: number,
    member: VoiceMemberInfo,
  ): Promise<void> {
    try {
      // Check if signup already exists (re-join case)
      const [existing] = await this.db
        .select({ id: schema.eventSignups.id })
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, eventId),
            eq(schema.eventSignups.discordUserId, member.discordUserId),
          ),
        )
        .limit(1);

      if (existing) return;

      // Create signup with Discord identity (and userId if linked)
      const [signup] = await this.db
        .insert(schema.eventSignups)
        .values({
          eventId,
          userId: member.userId,
          discordUserId: member.discordUserId,
          discordUsername: member.discordUsername,
          discordAvatarHash: member.discordAvatarHash,
          confirmationStatus: 'confirmed',
          status: 'signed_up',
        })
        .onConflictDoNothing()
        .returning({ id: schema.eventSignups.id });

      if (!signup) return; // Conflict — already exists

      // Find next available 'player' slot position
      const existingSlots = await this.db
        .select({ position: schema.rosterAssignments.position })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            eq(schema.rosterAssignments.role, 'player'),
          ),
        );

      const usedPositions = new Set(existingSlots.map((s) => s.position));

      // Ad-hoc events always use generic slotConfig with fixed defaults —
      // no need to query the event since we control the creation values.
      const maxPlayers = 25;
      const maxBench = 10;

      let position = 1;
      while (usedPositions.has(position) && position <= maxPlayers) {
        position++;
      }

      if (position <= maxPlayers) {
        // Assign to player slot
        await this.db.insert(schema.rosterAssignments).values({
          eventId,
          signupId: signup.id,
          role: 'player',
          position,
          isOverride: 0,
        });
      } else {
        // Player slots full — try bench
        const benchSlots = await this.db
          .select({ position: schema.rosterAssignments.position })
          .from(schema.rosterAssignments)
          .where(
            and(
              eq(schema.rosterAssignments.eventId, eventId),
              eq(schema.rosterAssignments.role, 'bench'),
            ),
          );

        const usedBench = new Set(benchSlots.map((s) => s.position));
        let benchPos = 1;
        while (usedBench.has(benchPos) && benchPos <= maxBench) {
          benchPos++;
        }

        if (benchPos <= maxBench) {
          await this.db.insert(schema.rosterAssignments).values({
            eventId,
            signupId: signup.id,
            role: 'bench',
            position: benchPos,
            isOverride: 0,
          });
        }
        // If both player and bench are full, signup exists but no slot assignment
      }

      this.logger.debug(
        `Auto-signed up ${member.discordUsername} for event ${eventId}`,
      );
    } catch (err) {
      this.logger.error(
        `Failed to auto-signup participant ${member.discordUserId} for event ${eventId}: ${err}`,
      );
    }
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

  /**
   * Build the active events map key.
   * Game-specific bindings: `{bindingId}`
   * General-lobby bindings (with gameId): `{bindingId}:{gameId}`
   * General-lobby bindings (no game detected): `{bindingId}:null`
   */
  private buildEventKey(bindingId: string, gameId?: number | null): string {
    if (gameId !== undefined && gameId !== null) {
      return `${bindingId}:${gameId}`;
    }
    // For game-specific bindings, gameId is undefined (not passed)
    // For general-lobby with no game, gameId is null
    if (gameId === null) {
      return `${bindingId}:null`;
    }
    return bindingId;
  }

  /**
   * Find the event key for a member leaving a channel.
   * For general-lobby, searches composite keys for the binding that contains
   * this member. Falls back to simple key for game-specific bindings.
   */
  private findEventKeyForMember(
    bindingId: string,
    discordUserId: string,
    gameId?: number | null,
  ): string | null {
    // If gameId is provided, try composite key directly
    if (gameId !== undefined) {
      const key = this.buildEventKey(bindingId, gameId);
      if (this.activeEvents.has(key)) return key;
    }

    // Try simple key (game-specific binding)
    if (this.activeEvents.has(bindingId)) return bindingId;

    // Search composite keys for this binding that contain this member
    for (const [key, state] of this.activeEvents) {
      if (
        (key === bindingId || key.startsWith(`${bindingId}:`)) &&
        state.memberSet.has(discordUserId)
      ) {
        return key;
      }
    }

    return null;
  }
}
