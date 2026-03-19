import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq, and, sql, notInArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { isSlotVacatedRelevant } from './slot-vacated-relevance.helpers';

/** Grace period before flushing a buffered roster notification (ms). */
export const ROSTER_NOTIFY_GRACE_MS = 3 * 60 * 1000; // 3 minutes

export interface BufferedRosterAction {
  /** Event creator (notification recipient). */
  organizerId: number;
  eventId: number;
  eventTitle: string;
  userId: number;
  displayName: string;
  /** The role the user left (e.g. 'tank', 'healer'). */
  vacatedRole: string;
}

interface BufferEntry {
  action: BufferedRosterAction;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Buffers organizer-facing roster-change notifications (ROK-534).
 *
 * When a player leaves/swaps slots in quick succession, each action upserts
 * a buffer entry keyed by `event:{eventId}:user:{userId}`. A 3-minute timer
 * resets on every upsert. When the timer fires, the service checks the
 * player's current roster state and sends a single net-result notification:
 *
 * - Player left entirely → "X left the Y slot for EventTitle"
 * - Player moved to a different slot → "X joined the Z slot for EventTitle"
 * - Player is back in same slot → no notification (action cancelled out)
 */
@Injectable()
export class RosterNotificationBufferService implements OnModuleDestroy {
  private readonly logger = new Logger(RosterNotificationBufferService.name);
  private readonly buffer = new Map<string, BufferEntry>();

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
  ) {}

  onModuleDestroy(): void {
    // Clear all pending timers on shutdown
    for (const entry of this.buffer.values()) {
      clearTimeout(entry.timer);
    }
    this.buffer.clear();
  }

  /**
   * Buffer a roster leave/vacate action. Resets the grace timer if one exists.
   */
  bufferLeave(action: BufferedRosterAction): void {
    const key = `event:${action.eventId}:user:${action.userId}`;

    // Clear existing timer if present (reset grace window)
    const existing = this.buffer.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    const timer = setTimeout(() => {
      this.flush(key).catch((err) => {
        this.logger.warn(
          `Failed to flush buffered notification for ${key}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    }, ROSTER_NOTIFY_GRACE_MS);

    // Prevent the timer from keeping the process alive
    if (timer.unref) {
      timer.unref();
    }

    this.buffer.set(key, { action, timer });
    this.logger.debug(
      `Buffered roster leave for ${key} (${action.displayName} left ${action.vacatedRole})`,
    );
  }

  /**
   * Record that a user has rejoined / changed slots on an event.
   * Resets the grace timer so the net result is evaluated later.
   */
  bufferJoin(eventId: number, userId: number): void {
    const key = `event:${eventId}:user:${userId}`;
    const existing = this.buffer.get(key);
    if (!existing) return; // Nothing buffered — no-op

    // Reset the timer so the flush re-evaluates net state after the join
    clearTimeout(existing.timer);
    const timer = setTimeout(() => {
      this.flush(key).catch((err) => {
        this.logger.warn(
          `Failed to flush buffered notification for ${key}: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
    }, ROSTER_NOTIFY_GRACE_MS);

    if (timer.unref) {
      timer.unref();
    }

    existing.timer = timer;
    this.logger.debug(`Reset buffer timer for ${key} (user rejoined)`);
  }

  /**
   * Flush a single buffer entry: resolve current roster state, send
   * the appropriate notification (or skip if the action cancelled out).
   */
  private async flush(key: string): Promise<void> {
    const entry = this.buffer.get(key);
    if (!entry) return;
    this.buffer.delete(key);

    const { action } = entry;
    const currentAssignment = await this.lookupCurrentAssignment(action);

    if (currentAssignment.length === 0) {
      await this.flushPlayerLeft(action);
    } else {
      const payload = await this.buildFlushPayload(action);
      await this.handleRoleChange(action, currentAssignment[0].role, payload);
    }
  }

  /** Flush a "player left" action with relevance check (ROK-919). */
  private async flushPlayerLeft(action: BufferedRosterAction): Promise<void> {
    const relevant = await this.checkRelevance(action);
    if (!relevant) {
      this.logger.debug(
        `Suppressed slot_vacated: not relevant (${action.vacatedRole} for event ${action.eventId})`,
      );
      return;
    }
    const payload = await this.buildFlushPayload(action);
    await this.notifyPlayerLeft(action, payload);
  }

  /** Check whether the departure is relevant enough to notify (ROK-919). */
  private async checkRelevance(action: BufferedRosterAction): Promise<boolean> {
    const event = await this.lookupEvent(action.eventId);
    if (!event) return false;
    // MMO role check is synchronous — skip count query when possible
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type === 'mmo') {
      return isSlotVacatedRelevant(event, action.vacatedRole, 0);
    }
    const count = await this.countActiveSignups(action.eventId);
    return isSlotVacatedRelevant(event, action.vacatedRole, count);
  }

  /** Look up the user's current roster assignment for this event. */
  private async lookupCurrentAssignment(action: BufferedRosterAction) {
    return this.db
      .select({ role: schema.rosterAssignments.role })
      .from(schema.rosterAssignments)
      .innerJoin(
        schema.eventSignups,
        eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
      )
      .where(
        and(
          eq(schema.eventSignups.eventId, action.eventId),
          eq(schema.eventSignups.userId, action.userId),
        ),
      )
      .limit(1);
  }

  /** Look up the event row for relevance checking. */
  private async lookupEvent(eventId: number) {
    const [event] = await this.db
      .select({
        slotConfig: schema.events.slotConfig,
        maxAttendees: schema.events.maxAttendees,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return event ?? null;
  }

  /** Count active signups for the event (excludes departed/declined/roached). */
  private async countActiveSignups(eventId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          notInArray(schema.eventSignups.status, [
            'departed',
            'declined',
            'roached_out',
          ]),
        ),
      )
      .limit(1);
    return Number(row?.count ?? 0);
  }

  /** Build the notification payload with Discord embed URL and voice channel. */
  private async buildFlushPayload(
    action: BufferedRosterAction,
  ): Promise<Record<string, unknown>> {
    const [discordUrl, voiceChannelId] = await Promise.all([
      this.notificationService.getDiscordEmbedUrl(action.eventId),
      this.notificationService.resolveVoiceChannelForEvent(action.eventId),
    ]);
    const payload: Record<string, unknown> = { eventId: action.eventId };
    if (discordUrl) payload.discordUrl = discordUrl;
    if (voiceChannelId) payload.voiceChannelId = voiceChannelId;
    return payload;
  }

  /** Notify organizer that a player left entirely. */
  private async notifyPlayerLeft(
    action: BufferedRosterAction,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.notificationService.create({
      userId: action.organizerId,
      type: 'slot_vacated',
      title: 'Slot Vacated',
      message: `${action.displayName} left the ${action.vacatedRole} slot for ${action.eventTitle}`,
      payload,
    });
    this.logger.debug(
      `Flushed: ${action.displayName} left ${action.vacatedRole} for event ${action.eventId}`,
    );
  }

  /** Handle role change: skip if same slot, notify if different. */
  private async handleRoleChange(
    action: BufferedRosterAction,
    newRole: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (newRole === action.vacatedRole) {
      this.logger.debug(
        `Skipped: ${action.displayName} returned to ${action.vacatedRole} for event ${action.eventId}`,
      );
      return;
    }
    await this.notificationService.create({
      userId: action.organizerId,
      type: 'slot_vacated',
      title: 'Roster Change',
      message: `${action.displayName} joined the ${newRole} slot for ${action.eventTitle}`,
      payload,
    });
    this.logger.debug(
      `Flushed: ${action.displayName} moved from ${action.vacatedRole} to ${newRole} for event ${action.eventId}`,
    );
  }

  /** Visible for testing — returns the number of buffered entries. */
  get pendingCount(): number {
    return this.buffer.size;
  }

  /** Visible for testing — force-flush all pending entries immediately. */
  async flushAll(): Promise<void> {
    const keys = [...this.buffer.keys()];
    for (const key of keys) {
      const entry = this.buffer.get(key);
      if (entry) {
        clearTimeout(entry.timer);
      }
      await this.flush(key);
    }
  }
}
