import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { NotificationService } from '../../notifications/notification.service';
import { SIGNUP_EVENTS } from '../discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot.constants';
import {
  DepartureGraceQueueService,
  DEPARTURE_GRACE_DELAY_MS,
} from '../queues/departure-grace.queue';

/**
 * Orchestrator for mid-event departure handling (ROK-596).
 *
 * Manages grace timers when members leave voice during live scheduled events.
 * Handles priority rejoin when a departed member returns.
 *
 * Flow:
 * 1. Member leaves voice → `onMemberLeave()` → enqueue grace timer
 * 2. Member returns within grace → `onMemberRejoin()` → cancel timer
 * 3. Grace expires → DepartureGraceProcessor handles slot freeing
 * 4. Member returns after departure → `onMemberRejoin()` → priority rejoin
 */
@Injectable()
export class DepartureGraceService {
  private readonly logger = new Logger(DepartureGraceService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly graceQueue: DepartureGraceQueueService,
    private readonly notificationService: NotificationService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Called when a member leaves voice during a live scheduled event.
   * Starts a grace timer if the member has an active signup.
   */
  async onMemberLeave(eventId: number, discordUserId: string): Promise<void> {
    try {
      // Check if event is scheduled (not ad-hoc)
      const [event] = await this.db
        .select({ isAdHoc: schema.events.isAdHoc })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event || event.isAdHoc) return;

      // Find the user's signup for this event
      const signup = await this.findActiveSignup(eventId, discordUserId);
      if (!signup) return;

      // Skip if already departed or cancelled
      if (
        signup.status === 'departed' ||
        signup.status === 'declined' ||
        signup.status === 'roached_out'
      ) {
        return;
      }

      // Enqueue grace timer
      await this.graceQueue.enqueue(
        {
          eventId,
          discordUserId,
          signupId: signup.id,
        },
        DEPARTURE_GRACE_DELAY_MS,
      );

      this.logger.debug(
        `Started departure grace timer for user ${discordUserId} on event ${eventId}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to handle member leave for ${discordUserId} on event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Called when a member joins/rejoins voice during a live scheduled event.
   * Cancels any pending grace timer, or triggers priority rejoin if already departed.
   */
  async onMemberRejoin(eventId: number, discordUserId: string): Promise<void> {
    try {
      // Cancel any pending grace timer
      await this.graceQueue.cancel(eventId, discordUserId);

      // Check if the member was already marked as departed (priority rejoin)
      const signup = await this.findSignupByStatus(
        eventId,
        discordUserId,
        'departed',
      );

      if (signup) {
        await this.handlePriorityRejoin(eventId, discordUserId, signup);
      }
    } catch (error) {
      this.logger.error(
        `Failed to handle member rejoin for ${discordUserId} on event ${eventId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Handle priority rejoin for a member who was marked as departed and returned.
   * Restores their signup status and attempts to reassign their roster slot.
   */
  private async handlePriorityRejoin(
    eventId: number,
    discordUserId: string,
    signup: typeof schema.eventSignups.$inferSelect,
  ): Promise<void> {
    // 1. Reset signup status from 'departed' back to 'signed_up'
    await this.db
      .update(schema.eventSignups)
      .set({ status: 'signed_up' })
      .where(eq(schema.eventSignups.id, signup.id));

    // 2. Try to find an empty roster slot to reassign them
    const assignedSlot = await this.tryRosterReassignment(eventId, signup.id);

    // 3. Resolve display name for notification
    const displayName = await this.resolveDisplayName(signup);

    // 4. Notify the event organizer
    const [event] = await this.db
      .select({
        creatorId: schema.events.creatorId,
        title: schema.events.title,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (event?.creatorId) {
      const slotInfo = assignedSlot
        ? ` (${assignedSlot.role}:${assignedSlot.position})`
        : ' (bench/unassigned)';
      const discordUrl =
        await this.notificationService.getDiscordEmbedUrl(eventId);
      const voiceChannelId =
        await this.notificationService.resolveVoiceChannelForEvent(eventId);

      await this.notificationService.create({
        userId: event.creatorId,
        type: 'slot_vacated',
        title: 'Member Returned',
        message: `${displayName} returned — reassigned to roster${slotInfo} for "${event.title}"`,
        payload: {
          eventId,
          ...(discordUrl ? { discordUrl } : {}),
          ...(voiceChannelId ? { voiceChannelId } : {}),
        },
      });
    }

    // 5. Emit signup event for Discord embed sync
    this.eventEmitter.emit(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'priority_rejoin',
    } satisfies SignupEventPayload);

    this.logger.log(
      `Priority rejoin: user ${discordUserId} reassigned to roster for event ${eventId}`,
    );
  }

  /**
   * Attempt to reassign a returning member to a roster slot.
   * Does NOT displace anyone who was promoted or assigned after departure.
   */
  private async tryRosterReassignment(
    eventId: number,
    signupId: number,
  ): Promise<{ role: string; position: number } | null> {
    // Get the event's slot config to understand what slots exist
    const [event] = await this.db
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) return null;

    // Get all current roster assignments for this event
    const currentAssignments = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    const occupiedSlots = new Set(
      currentAssignments.map((a) => `${a.role}:${a.position}`),
    );

    // Parse slot config to find available slots
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    let availableSlot: { role: string; position: number } | null = null;

    if (slotConfig?.type === 'mmo') {
      // MMO events: look for open role-based slots
      const roles = slotConfig.roles as
        | Array<{ role: string; count: number }>
        | undefined;
      if (roles) {
        for (const roleConfig of roles) {
          for (let pos = 1; pos <= roleConfig.count; pos++) {
            if (!occupiedSlots.has(`${roleConfig.role}:${pos}`)) {
              availableSlot = { role: roleConfig.role, position: pos };
              break;
            }
          }
          if (availableSlot) break;
        }
      }
    } else {
      // Generic events: look for open player slots
      const maxPlayers =
        (slotConfig?.maxPlayers as number) ??
        (slotConfig?.count as number) ??
        0;
      if (maxPlayers > 0) {
        for (let pos = 1; pos <= maxPlayers; pos++) {
          if (!occupiedSlots.has(`player:${pos}`)) {
            availableSlot = { role: 'player', position: pos };
            break;
          }
        }
      }
    }

    if (availableSlot) {
      await this.db.insert(schema.rosterAssignments).values({
        eventId,
        signupId,
        role: availableSlot.role,
        position: availableSlot.position,
      });

      this.logger.debug(
        `Reassigned signup ${signupId} to slot ${availableSlot.role}:${availableSlot.position} for event ${eventId}`,
      );
    }

    return availableSlot;
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Find a user's active signup for an event (by discord user ID or linked RL user).
   */
  private async findActiveSignup(
    eventId: number,
    discordUserId: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    // First try direct discord user ID match
    const [directMatch] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
        ),
      )
      .limit(1);

    if (directMatch) return directMatch;

    // Try via linked RL user
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (!user) return undefined;

    const [userMatch] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, user.id),
        ),
      )
      .limit(1);

    return userMatch;
  }

  /**
   * Find a signup with a specific status.
   */
  private async findSignupByStatus(
    eventId: number,
    discordUserId: string,
    status: string,
  ): Promise<typeof schema.eventSignups.$inferSelect | undefined> {
    // Direct discord user ID match
    const [directMatch] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
          eq(schema.eventSignups.status, status),
        ),
      )
      .limit(1);

    if (directMatch) return directMatch;

    // Via linked RL user
    const [user] = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (!user) return undefined;

    const [userMatch] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, user.id),
          eq(schema.eventSignups.status, status),
        ),
      )
      .limit(1);

    return userMatch;
  }

  private async resolveDisplayName(
    signup: typeof schema.eventSignups.$inferSelect,
  ): Promise<string> {
    if (signup.discordUsername) return signup.discordUsername;
    if (signup.userId) {
      const [user] = await this.db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, signup.userId))
        .limit(1);
      if (user) return user.username;
    }
    return signup.discordUserId ?? 'Unknown';
  }
}
