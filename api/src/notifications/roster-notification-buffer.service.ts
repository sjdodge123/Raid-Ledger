import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';

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

    // Look up the user's current roster assignment for this event
    const currentAssignment = await this.db
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

    // Resolve Discord embed URL and voice channel for the notification payload
    const [discordUrl, voiceChannelId] = await Promise.all([
      this.notificationService.getDiscordEmbedUrl(action.eventId),
      this.notificationService.resolveVoiceChannelForEvent(action.eventId),
    ]);

    const payload: Record<string, unknown> = { eventId: action.eventId };
    if (discordUrl) payload.discordUrl = discordUrl;
    if (voiceChannelId) payload.voiceChannelId = voiceChannelId;

    if (currentAssignment.length === 0) {
      // Net result: player left entirely
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
    } else {
      const newRole = currentAssignment[0].role;
      if (newRole === action.vacatedRole) {
        // Player is back in the same slot — the action cancelled out, skip notification
        this.logger.debug(
          `Skipped: ${action.displayName} returned to ${action.vacatedRole} for event ${action.eventId}`,
        );
      } else {
        // Player moved to a different slot
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
    }
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
