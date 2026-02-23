/* eslint-disable */
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, or, sql, isNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { BenchPromotionService } from './bench-promotion.service';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import type {
  SignupResponseDto,
  EventRosterDto,
  CreateSignupDto,
  ConfirmSignupDto,
  SignupCharacterDto,
  ConfirmationStatus,
  SignupStatus,
  UpdateRosterDto,
  RosterWithAssignments,
  RosterAssignmentResponse,
  RosterRole,
  CreateDiscordSignupDto,
  UpdateSignupStatusDto,
} from '@raid-ledger/contract';

/**
 * Service for managing event signups (FR-006), character confirmation (ROK-131),
 * and anonymous Discord signups (ROK-137).
 */
@Injectable()
export class SignupsService {
  private readonly logger = new Logger(SignupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private notificationService: NotificationService,
    private benchPromotionService: BenchPromotionService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Sign up a user for an event.
   * Uses insert-first approach with constraint handling for race condition safety.
   * @param eventId - Event to sign up for
   * @param userId - User signing up
   * @param dto - Optional signup data (note)
   * @returns The signup record
   * @throws NotFoundException if event doesn't exist
   */
  async signup(
    eventId: number,
    userId: number,
    dto?: CreateSignupDto,
  ): Promise<SignupResponseDto> {
    // Verify event exists first
    const event = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (event.length === 0) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Pre-fetch user data to avoid N+1 after insert
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    // ROK-439: Validate character belongs to user if provided
    if (dto?.characterId) {
      const [character] = await this.db
        .select()
        .from(schema.characters)
        .where(
          and(
            eq(schema.characters.id, dto.characterId),
            eq(schema.characters.userId, userId),
          ),
        )
        .limit(1);

      if (!character) {
        throw new BadRequestException(
          'Character not found or does not belong to you',
        );
      }
    }

    // Wrap capacity check + insert + roster assignment in a transaction to
    // prevent TOCTOU races where two concurrent signups both read count < max.
    // Uses onConflictDoNothing to handle duplicate signups gracefully (ROK-364).
    const result = await this.db.transaction(async (tx) => {
      // When event is at capacity, auto-bench the signup instead of rejecting.
      // If the user explicitly targets a bench slot, allow it regardless.
      // Count only non-bench signups to accurately reflect player capacity.
      let autoBench = false;
      if (event[0].maxAttendees && dto?.slotRole !== 'bench') {
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)` })
          .from(schema.eventSignups)
          .innerJoin(
            schema.rosterAssignments,
            eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
          )
          .where(
            and(
              eq(schema.eventSignups.eventId, eventId),
              sql`${schema.rosterAssignments.role} != 'bench'`,
            ),
          );
        if (Number(count) >= event[0].maxAttendees) {
          autoBench = true;
        }
      }

      // ROK-439: If characterId provided, set it and mark confirmed in one step
      const hasCharacter = !!dto?.characterId;
      const rows = await tx
        .insert(schema.eventSignups)
        .values({
          eventId,
          userId,
          note: dto?.note ?? null,
          characterId: dto?.characterId ?? null,
          confirmationStatus: hasCharacter ? 'confirmed' : 'pending',
          status: 'signed_up',
        })
        .onConflictDoNothing({
          target: [schema.eventSignups.eventId, schema.eventSignups.userId],
        })
        .returning();

      // If the insert was a no-op (duplicate), return the existing signup
      if (rows.length === 0) {
        const [existing] = await tx
          .select()
          .from(schema.eventSignups)
          .where(
            and(
              eq(schema.eventSignups.eventId, eventId),
              eq(schema.eventSignups.userId, userId),
            ),
          )
          .limit(1);

        // ROK-353: If caller requested a slot but the signup has no roster
        // assignment (e.g. after self-unassign), create one now.
        const slotRole = autoBench ? 'bench' : dto?.slotRole;
        if (slotRole) {
          const existingAssignment = await tx
            .select()
            .from(schema.rosterAssignments)
            .where(eq(schema.rosterAssignments.signupId, existing.id))
            .limit(1);

          if (existingAssignment.length === 0) {
            let position = dto?.slotPosition ?? 0;
            if (autoBench || !position) {
              const positionsInRole = await tx
                .select({ position: schema.rosterAssignments.position })
                .from(schema.rosterAssignments)
                .where(
                  and(
                    eq(schema.rosterAssignments.eventId, eventId),
                    eq(schema.rosterAssignments.role, slotRole),
                  ),
                );
              position =
                positionsInRole.reduce(
                  (max, r) => Math.max(max, r.position),
                  0,
                ) + 1;
            }

            await tx.insert(schema.rosterAssignments).values({
              eventId,
              signupId: existing.id,
              role: slotRole,
              position,
              isOverride: 0,
            });
            this.logger.log(
              `Re-assigned user ${userId} to ${slotRole} slot ${position} (existing signup)`,
            );

            if (slotRole !== 'bench') {
              await this.benchPromotionService.cancelPromotion(
                eventId,
                slotRole,
                position,
              );
            }
          }
        }

        const character = existing.characterId
          ? await this.getCharacterById(existing.characterId)
          : null;
        return {
          isDuplicate: true as const,
          response: this.buildSignupResponse(existing, user, character),
        };
      }

      const [inserted] = rows;
      this.logger.log(`User ${userId} signed up for event ${eventId}`);

      // ROK-183: Create roster assignment — explicit slot or auto-bench
      const slotRole = autoBench ? 'bench' : dto?.slotRole;
      if (slotRole) {
        // Determine position: use provided or find next available
        let position = dto?.slotPosition ?? 0;
        if (autoBench || !position) {
          const existing = await tx
            .select({ position: schema.rosterAssignments.position })
            .from(schema.rosterAssignments)
            .where(
              and(
                eq(schema.rosterAssignments.eventId, eventId),
                eq(schema.rosterAssignments.role, slotRole),
              ),
            );
          position =
            existing.reduce((max, r) => Math.max(max, r.position), 0) + 1;
        }

        await tx.insert(schema.rosterAssignments).values({
          eventId,
          signupId: inserted.id,
          role: slotRole,
          position,
          isOverride: 0,
        });
        this.logger.log(
          `Assigned user ${userId} to ${slotRole} slot ${position}${autoBench ? ' (auto-benched)' : ''}`,
        );

        // ROK-229: Cancel any pending bench promotion for this slot
        if (slotRole !== 'bench') {
          await this.benchPromotionService.cancelPromotion(
            eventId,
            slotRole,
            position,
          );
        }
      }

      return { isDuplicate: false as const, signup: inserted };
    });

    if (result.isDuplicate) {
      // ROK-409: Clean up stale PUG slots even for duplicate signups
      this.cleanupMatchingPugSlots(eventId, userId).catch((err) => {
        this.logger.warn(
          'Failed to cleanup PUG slots for user %d on event %d: %s',
          userId,
          eventId,
          err instanceof Error ? err.message : 'Unknown error',
        );
      });
      return result.response;
    }

    // ROK-409: Clean up stale PUG slots after successful signup
    this.cleanupMatchingPugSlots(eventId, userId).catch((err) => {
      this.logger.warn(
        'Failed to cleanup PUG slots for user %d on event %d: %s',
        userId,
        eventId,
        err instanceof Error ? err.message : 'Unknown error',
      );
    });

    this.emitSignupEvent(SIGNUP_EVENTS.CREATED, {
      eventId,
      userId,
      signupId: result.signup.id,
      action: 'signup_created',
    });

    // ROK-439: If character was provided upfront, include it in the response
    const character = dto?.characterId
      ? await this.getCharacterById(dto.characterId)
      : null;

    return this.buildSignupResponse(result.signup, user, character);
  }

  /**
   * Create an anonymous Discord participant signup (ROK-137 Path B).
   * @param eventId - Event to sign up for
   * @param dto - Discord user info and optional role
   * @returns The signup record
   */
  async signupDiscord(
    eventId: number,
    dto: CreateDiscordSignupDto,
  ): Promise<SignupResponseDto> {
    // Verify event exists
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Check if this Discord user already has an RL account linked
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, dto.discordUserId))
      .limit(1);

    if (linkedUser) {
      // User has an RL account — use the normal signup path
      return this.signup(eventId, linkedUser.id);
    }

    // Insert anonymous signup
    // ROK-457: Discord signups bypass character confirmation — auto-confirm
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(schema.eventSignups)
        .values({
          eventId,
          userId: null,
          discordUserId: dto.discordUserId,
          discordUsername: dto.discordUsername,
          discordAvatarHash: dto.discordAvatarHash ?? null,
          confirmationStatus: 'confirmed',
          status: dto.status ?? 'signed_up',
        })
        .onConflictDoNothing({
          target: [
            schema.eventSignups.eventId,
            schema.eventSignups.discordUserId,
          ],
        })
        .returning();

      if (rows.length === 0) {
        // Already signed up — return existing
        const [existing] = await tx
          .select()
          .from(schema.eventSignups)
          .where(
            and(
              eq(schema.eventSignups.eventId, eventId),
              eq(schema.eventSignups.discordUserId, dto.discordUserId),
            ),
          )
          .limit(1);

        return existing;
      }

      const [inserted] = rows;

      // If role was provided, create roster assignment
      if (dto.role) {
        const existingPositions = await tx
          .select({ position: schema.rosterAssignments.position })
          .from(schema.rosterAssignments)
          .where(
            and(
              eq(schema.rosterAssignments.eventId, eventId),
              eq(schema.rosterAssignments.role, dto.role),
            ),
          );
        const position =
          existingPositions.reduce((max, r) => Math.max(max, r.position), 0) +
          1;

        await tx.insert(schema.rosterAssignments).values({
          eventId,
          signupId: inserted.id,
          role: dto.role,
          position,
          isOverride: 0,
        });
      }

      this.logger.log(
        `Anonymous Discord user ${dto.discordUsername} (${dto.discordUserId}) signed up for event ${eventId}`,
      );

      return inserted;
    });

    this.emitSignupEvent(SIGNUP_EVENTS.CREATED, {
      eventId,
      signupId: result.id,
      action: 'discord_signup_created',
    });

    return this.buildAnonymousSignupResponse(result);
  }

  /**
   * Update a signup's attendance status (ROK-137).
   * Works for both RL members and anonymous Discord participants.
   */
  async updateStatus(
    eventId: number,
    signupIdentifier: { userId?: number; discordUserId?: string },
    dto: UpdateSignupStatusDto,
  ): Promise<SignupResponseDto> {
    const conditions = [eq(schema.eventSignups.eventId, eventId)];

    if (signupIdentifier.userId) {
      conditions.push(
        eq(schema.eventSignups.userId, signupIdentifier.userId),
      );
    } else if (signupIdentifier.discordUserId) {
      conditions.push(
        eq(
          schema.eventSignups.discordUserId,
          signupIdentifier.discordUserId,
        ),
      );
    } else {
      throw new BadRequestException(
        'Either userId or discordUserId must be provided',
      );
    }

    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(and(...conditions))
      .limit(1);

    if (!signup) {
      throw new NotFoundException('Signup not found');
    }

    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({ status: dto.status })
      .where(eq(schema.eventSignups.id, signup.id))
      .returning();

    this.logger.log(
      `Signup ${signup.id} status updated to ${dto.status} for event ${eventId}`,
    );

    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId: updated.userId,
      signupId: updated.id,
      action: `status_changed_to_${dto.status}`,
    });

    if (updated.userId) {
      const [user] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, updated.userId))
        .limit(1);
      const character = updated.characterId
        ? await this.getCharacterById(updated.characterId)
        : null;
      return this.buildSignupResponse(updated, user, character);
    }

    return this.buildAnonymousSignupResponse(updated);
  }

  /**
   * Find a signup by Discord user ID for a given event.
   */
  async findByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<SignupResponseDto | null> {
    // First check if this Discord user has a linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      const [signup] = await this.db
        .select()
        .from(schema.eventSignups)
        .where(
          and(
            eq(schema.eventSignups.eventId, eventId),
            eq(schema.eventSignups.userId, linkedUser.id),
          ),
        )
        .limit(1);

      if (!signup) return null;
      const character = signup.characterId
        ? await this.getCharacterById(signup.characterId)
        : null;
      return this.buildSignupResponse(signup, linkedUser, character);
    }

    // Check for anonymous signup
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
        ),
      )
      .limit(1);

    if (!signup) return null;
    return this.buildAnonymousSignupResponse(signup);
  }

  /**
   * Cancel a signup by Discord user ID.
   * Works for both linked RL accounts and anonymous participants.
   */
  async cancelByDiscordUser(
    eventId: number,
    discordUserId: string,
  ): Promise<void> {
    // Check if Discord user has a linked RL account
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      return this.cancel(eventId, linkedUser.id);
    }

    // Cancel anonymous signup
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
        ),
      )
      .limit(1);

    if (!signup) {
      throw new NotFoundException(
        `Signup not found for Discord user ${discordUserId} on event ${eventId}`,
      );
    }

    await this.db
      .delete(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signup.id));

    this.logger.log(
      `Anonymous Discord user ${discordUserId} canceled signup for event ${eventId}`,
    );

    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      signupId: signup.id,
      action: 'discord_signup_cancelled',
    });
  }

  /**
   * Claim anonymous signups when a Discord user creates an RL account (ROK-137).
   * Backfills user_id on signups that match the discord_user_id.
   */
  async claimAnonymousSignups(
    discordUserId: string,
    userId: number,
  ): Promise<number> {
    const result = await this.db
      .update(schema.eventSignups)
      .set({ userId })
      .where(
        and(
          eq(schema.eventSignups.discordUserId, discordUserId),
          isNull(schema.eventSignups.userId),
        ),
      )
      .returning();

    if (result.length > 0) {
      this.logger.log(
        `Claimed ${result.length} anonymous signup(s) for Discord user ${discordUserId} → RL user ${userId}`,
      );
    }

    return result.length;
  }

  /**
   * Confirm a signup with a specific character (ROK-131 AC-2).
   * @param eventId - Event ID
   * @param signupId - Signup ID to confirm
   * @param userId - User making the request (for authorization)
   * @param dto - Character selection data
   * @returns Updated signup with character info
   * @throws NotFoundException if signup doesn't exist
   * @throws ForbiddenException if user doesn't own the signup
   * @throws BadRequestException if character doesn't belong to user
   */
  async confirmSignup(
    eventId: number,
    signupId: number,
    userId: number,
    dto: ConfirmSignupDto,
  ): Promise<SignupResponseDto> {
    // Fetch signup and verify ownership
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.id, signupId),
          eq(schema.eventSignups.eventId, eventId),
        ),
      )
      .limit(1);

    if (!signup) {
      throw new NotFoundException(
        `Signup ${signupId} not found for event ${eventId}`,
      );
    }

    if (signup.userId !== userId) {
      throw new ForbiddenException('You can only confirm your own signup');
    }

    // Verify character belongs to user
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.id, dto.characterId),
          eq(schema.characters.userId, userId),
        ),
      )
      .limit(1);

    if (!character) {
      throw new BadRequestException(
        'Character not found or does not belong to you',
      );
    }

    // Determine new status: 'confirmed' if first time, 'changed' if re-confirming
    const newStatus: ConfirmationStatus =
      signup.confirmationStatus === 'pending' ? 'confirmed' : 'changed';

    // Update signup with character
    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({
        characterId: dto.characterId,
        confirmationStatus: newStatus,
      })
      .where(eq(schema.eventSignups.id, signupId))
      .returning();

    // Fetch user data
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    this.logger.log(
      `User ${userId} confirmed signup ${signupId} with character ${dto.characterId}`,
    );

    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId,
      action: 'signup_confirmed',
    });

    return this.buildSignupResponse(updated, user, character);
  }

  /**
   * Cancel a user's signup for an event.
   * @param eventId - Event to cancel signup for
   * @param userId - User canceling
   * @throws NotFoundException if signup doesn't exist
   */
  async cancel(eventId: number, userId: number): Promise<void> {
    // Find the signup first to get its ID
    let [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      )
      .limit(1);

    // ROK-119: If not found by userId, check for unclaimed anonymous signup
    // matching the user's discordId (e.g., Quick Sign Up before account link).
    if (!signup) {
      const [user] = await this.db
        .select({ discordId: schema.users.discordId })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1);

      if (user?.discordId) {
        [signup] = await this.db
          .select()
          .from(schema.eventSignups)
          .where(
            and(
              eq(schema.eventSignups.eventId, eventId),
              eq(schema.eventSignups.discordUserId, user.discordId),
            ),
          )
          .limit(1);
      }
    }

    if (!signup) {
      throw new NotFoundException(
        `Signup not found for user ${userId} on event ${eventId}`,
      );
    }

    // Check if user held a roster assignment
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);

    // Gather notification data before deleting (if assigned)
    let notifyData: {
      creatorId: number;
      eventTitle: string;
      role: string | null;
      displayName: string;
    } | null = null;
    if (assignment) {
      const [[event], [user]] = await Promise.all([
        this.db
          .select({
            creatorId: schema.events.creatorId,
            title: schema.events.title,
          })
          .from(schema.events)
          .where(eq(schema.events.id, eventId))
          .limit(1),
        this.db
          .select({ username: schema.users.username })
          .from(schema.users)
          .where(eq(schema.users.id, userId))
          .limit(1),
      ]);
      notifyData = {
        creatorId: event.creatorId,
        eventTitle: event.title,
        role: assignment.role,
        displayName: user?.username ?? 'Unknown',
      };
    }

    // Delete the signup (cascade removes the roster assignment)
    await this.db
      .delete(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signup.id));

    this.logger.log(`User ${userId} canceled signup for event ${eventId}`);

    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'signup_cancelled',
    });

    // Notify organizer if the user held a roster slot
    if (notifyData) {
      const slotLabel = notifyData.role ?? 'assigned';
      await this.notificationService.create({
        userId: notifyData.creatorId,
        type: 'slot_vacated',
        title: 'Slot Vacated',
        message: `${notifyData.displayName} left the ${slotLabel} slot for ${notifyData.eventTitle}`,
        payload: { eventId },
      });

      // ROK-229: Schedule bench promotion for vacated non-bench slot
      if (
        assignment &&
        assignment.role &&
        assignment.role !== 'bench' &&
        (await this.benchPromotionService.isEligible(eventId))
      ) {
        await this.benchPromotionService.schedulePromotion(
          eventId,
          assignment.role,
          assignment.position,
        );
      }
    }
  }

  /**
   * Get the roster (all signups) for an event.
   * Includes character data for confirmed signups (ROK-131 AC-6).
   * Now includes anonymous Discord participants (ROK-137).
   * @param eventId - Event to get roster for
   * @returns List of signups with user and character info
   * @throws NotFoundException if event doesn't exist
   */
  async getRoster(eventId: number): Promise<EventRosterDto> {
    // Verify event exists
    const event = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (event.length === 0) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Get signups with user and character info (single query with joins)
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(eq(schema.eventSignups.eventId, eventId))
      .orderBy(schema.eventSignups.signedUpAt);

    const signupResponses: SignupResponseDto[] = signups.map((row) => {
      const isAnonymous = !row.event_signups.userId;
      if (isAnonymous) {
        return this.buildAnonymousSignupResponse(row.event_signups);
      }
      return {
        id: row.event_signups.id,
        eventId: row.event_signups.eventId,
        user: {
          id: row.users?.id ?? 0,
          discordId: row.users?.discordId ?? '',
          username: row.users?.username ?? 'Unknown',
          avatar: row.users?.avatar ?? null,
        },
        note: row.event_signups.note,
        signedUpAt: row.event_signups.signedUpAt.toISOString(),
        characterId: row.event_signups.characterId,
        character: row.characters
          ? this.buildCharacterDto(row.characters)
          : null,
        confirmationStatus: row.event_signups
          .confirmationStatus as ConfirmationStatus,
        status: (row.event_signups.status as SignupStatus) ?? 'signed_up',
      };
    });

    return {
      eventId,
      signups: signupResponses,
      count: signupResponses.length,
    };
  }

  /**
   * Get a character by ID.
   * @param characterId - Character UUID
   */
  private async getCharacterById(
    characterId: string,
  ): Promise<typeof schema.characters.$inferSelect | null> {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, characterId))
      .limit(1);
    return character ?? null;
  }

  /**
   * Build character DTO for signup response.
   */
  private buildCharacterDto(
    character: typeof schema.characters.$inferSelect,
  ): SignupCharacterDto {
    const roleOverride = character.roleOverride as
      | 'tank'
      | 'healer'
      | 'dps'
      | null;
    const role = character.role as 'tank' | 'healer' | 'dps' | null;
    return {
      id: character.id,
      name: character.name,
      class: character.class,
      spec: character.spec,
      role: roleOverride ?? role,
      isMain: character.isMain,
      itemLevel: character.itemLevel,
      level: character.level,
      avatarUrl: character.avatarUrl,
      race: character.race,
      faction: character.faction as 'alliance' | 'horde' | null,
    };
  }

  /**
   * Build signup response from signup, user, and optional character data.
   * Used to avoid N+1 queries by accepting pre-fetched data.
   */
  private buildSignupResponse(
    signup: typeof schema.eventSignups.$inferSelect,
    user: typeof schema.users.$inferSelect | undefined,
    character: typeof schema.characters.$inferSelect | null,
  ): SignupResponseDto {
    return {
      id: signup.id,
      eventId: signup.eventId,
      user: {
        id: user?.id ?? 0,
        discordId: user?.discordId ?? '',
        username: user?.username ?? 'Unknown',
        avatar: user?.avatar ?? null,
      },
      note: signup.note,
      signedUpAt: signup.signedUpAt.toISOString(),
      characterId: signup.characterId,
      character: character ? this.buildCharacterDto(character) : null,
      confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
      status: (signup.status as SignupStatus) ?? 'signed_up',
    };
  }

  /**
   * Build signup response for anonymous Discord participants (ROK-137).
   */
  private buildAnonymousSignupResponse(
    signup: typeof schema.eventSignups.$inferSelect,
  ): SignupResponseDto {
    return {
      id: signup.id,
      eventId: signup.eventId,
      user: {
        id: 0,
        discordId: signup.discordUserId ?? '',
        username: signup.discordUsername ?? 'Discord User',
        avatar: null,
      },
      note: signup.note,
      signedUpAt: signup.signedUpAt.toISOString(),
      characterId: null,
      character: null,
      confirmationStatus: signup.confirmationStatus as ConfirmationStatus,
      status: (signup.status as SignupStatus) ?? 'signed_up',
      isAnonymous: true,
      discordUserId: signup.discordUserId,
      discordUsername: signup.discordUsername,
      discordAvatarHash: signup.discordAvatarHash,
    };
  }

  /**
   * Self-unassign the current user from their roster slot (ROK-226).
   * Removes the roster assignment only — user stays signed up in the pool.
   * Dispatches slot_vacated notification to the event organizer.
   * @param eventId - Event ID
   * @param userId - User requesting self-unassign
   * @returns Updated roster with assignments
   * @throws NotFoundException if signup or assignment doesn't exist
   */
  async selfUnassign(
    eventId: number,
    userId: number,
  ): Promise<RosterWithAssignments> {
    // Find the user's signup
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      )
      .limit(1);

    if (!signup) {
      throw new NotFoundException(
        `Signup not found for user ${userId} on event ${eventId}`,
      );
    }

    // Find the user's roster assignment
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);

    if (!assignment) {
      throw new NotFoundException(
        `No roster assignment found for user ${userId} on event ${eventId}`,
      );
    }

    // Gather notification data before deleting
    const [[event], [user]] = await Promise.all([
      this.db
        .select({
          creatorId: schema.events.creatorId,
          title: schema.events.title,
        })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1),
      this.db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, userId))
        .limit(1),
    ]);

    // Delete only the roster assignment (keep the signup)
    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.id, assignment.id));

    this.logger.log(
      `User ${userId} self-unassigned from ${assignment.role} slot for event ${eventId}`,
    );

    // Emit signup event so Discord embed is re-synced (ROK-458)
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'self_unassigned',
    });

    // Notify organizer about the vacated slot
    const slotLabel = assignment.role ?? 'assigned';
    await this.notificationService.create({
      userId: event.creatorId,
      type: 'slot_vacated',
      title: 'Slot Vacated',
      message: `${user?.username ?? 'Unknown'} left the ${slotLabel} slot for ${event.title}`,
      payload: { eventId },
    });

    // ROK-229: Schedule bench promotion for vacated non-bench slot
    if (
      assignment.role &&
      assignment.role !== 'bench' &&
      (await this.benchPromotionService.isEligible(eventId))
    ) {
      await this.benchPromotionService.schedulePromotion(
        eventId,
        assignment.role,
        assignment.position,
      );
    }

    return this.getRosterWithAssignments(eventId);
  }

  /**
   * Admin-remove a signup from an event (ROK-402).
   * Deletes their signup (cascade removes roster assignment) and cleans up PUG slots.
   * Sends a notification to the removed user (if registered).
   * Works for both registered users and anonymous PUG participants.
   * @param eventId - Event ID
   * @param signupId - Signup row ID to remove
   * @param requesterId - User performing the removal (for authorization)
   * @param isAdmin - Whether requester is admin/operator
   */
  async adminRemoveSignup(
    eventId: number,
    signupId: number,
    requesterId: number,
    isAdmin: boolean,
  ): Promise<void> {
    // Verify event exists and requester has permission
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    if (event.creatorId !== requesterId && !isAdmin) {
      throw new ForbiddenException(
        'Only event creator or admin/operator can remove users from an event',
      );
    }

    // Find the signup by ID
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.id, signupId),
          eq(schema.eventSignups.eventId, eventId),
        ),
      )
      .limit(1);

    if (!signup) {
      throw new NotFoundException(
        `Signup ${signupId} not found for event ${eventId}`,
      );
    }

    // Check for roster assignment (for bench promotion)
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);

    // Clean up PUG slots claimed by the removed user (if registered)
    if (signup.userId) {
      await this.db
        .delete(schema.pugSlots)
        .where(
          and(
            eq(schema.pugSlots.eventId, eventId),
            eq(schema.pugSlots.claimedByUserId, signup.userId),
          ),
        );
    }

    // Delete the signup (cascade removes the roster assignment)
    await this.db
      .delete(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signup.id));

    this.logger.log(
      `Admin ${requesterId} removed signup ${signupId} from event ${eventId}`,
    );

    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'admin_removed',
    });

    // Notify the removed user (only if they have a registered account)
    if (signup.userId) {
      await this.notificationService.create({
        userId: signup.userId,
        type: 'slot_vacated',
        title: 'Removed from Event',
        message: `You were removed from ${event.title}`,
        payload: { eventId },
      });
    }

    // Schedule bench promotion if the user held a non-bench roster slot
    if (
      assignment &&
      assignment.role &&
      assignment.role !== 'bench' &&
      (await this.benchPromotionService.isEligible(eventId))
    ) {
      await this.benchPromotionService.schedulePromotion(
        eventId,
        assignment.role,
        assignment.position,
      );
    }
  }

  // ============================================================
  // Roster Assignment Methods (ROK-114)
  // ============================================================

  /**
   * Update roster assignments for an event (ROK-114 AC-5).
   * Replaces all current assignments with new ones.
   * @param eventId - Event ID
   * @param userId - User making the request (for authorization)
   * @param isAdmin - Whether user is admin
   * @param dto - New assignments
   * @returns Updated roster with assignments
   */
  async updateRoster(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: UpdateRosterDto,
  ): Promise<RosterWithAssignments> {
    // Verify event exists and user has permission
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Only event creator or admin can update roster
    if (event.creatorId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only event creator, admin, or operator can update roster',
      );
    }

    // Validate all assignments: user must be signed up
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    const signupByUserId = new Map(signups.map((s) => [s.userId, s]));

    for (const assignment of dto.assignments) {
      const signup = signupByUserId.get(assignment.userId);
      if (!signup) {
        throw new BadRequestException(
          `User ${assignment.userId} is not signed up for this event`,
        );
      }
    }

    // ROK-390: Capture old assignments before deleting (for role-change diff)
    const oldAssignments = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    // Build lookup: signupId → old role
    const oldRoleBySignupId = new Map(
      oldAssignments.map((a) => [a.signupId, a.role]),
    );

    // Delete existing assignments
    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    // Insert new assignments
    if (dto.assignments.length > 0) {
      const assignmentValues = dto.assignments.map((a) => {
        const signup = signupByUserId.get(a.userId)!;
        return {
          eventId,
          signupId: a.signupId ?? signup.id,
          role: a.slot,
          position: a.position,
          isOverride: a.isOverride ? 1 : 0,
        };
      });

      await this.db.insert(schema.rosterAssignments).values(assignmentValues);

      // ROK-229: Cancel pending bench promotions for any non-bench slots that are now filled
      for (const a of dto.assignments) {
        if (a.slot && a.slot !== 'bench') {
          await this.benchPromotionService.cancelPromotion(
            eventId,
            a.slot,
            a.position,
          );
        }
      }
    }

    this.logger.log(
      `Roster updated for event ${eventId}: ${dto.assignments.length} assignments`,
    );

    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      action: 'roster_updated',
    });

    // ROK-390: Notify players whose role changed (async, non-blocking)
    this.notifyRoleChanges(
      eventId,
      event.title,
      dto.assignments,
      signupByUserId,
      oldRoleBySignupId,
    ).catch((err) => {
      this.logger.warn(
        'Failed to send roster reassign notifications: %s',
        err instanceof Error ? err.message : 'Unknown error',
      );
    });

    return this.getRosterWithAssignments(eventId);
  }

  /**
   * Get roster with assignment data (ROK-114 AC-5).
   * Returns both unassigned pool and assigned slots.
   * @param eventId - Event ID
   * @returns Roster with pool and assignments
   */
  async getRosterWithAssignments(
    eventId: number,
  ): Promise<RosterWithAssignments> {
    // Verify event exists
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // Get all signups with user and character data
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(eq(schema.eventSignups.eventId, eventId))
      .orderBy(schema.eventSignups.signedUpAt);

    // Get all assignments
    const assignments = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    const assignmentBySignupId = new Map(
      assignments.map((a) => [a.signupId, a]),
    );

    // Build response arrays
    const pool: RosterAssignmentResponse[] = [];
    const assigned: RosterAssignmentResponse[] = [];

    for (const row of signups) {
      const assignment = assignmentBySignupId.get(row.event_signups.id);
      const response = this.buildRosterAssignmentResponse(row, assignment);

      if (assignment) {
        assigned.push(response);
      } else {
        pool.push(response);
      }
    }

    // Use per-event slot config if set, otherwise fall back to genre-based detection.
    // When maxAttendees is set (e.g. Phasmophobia max 4), use it as the player slot count.
    let slots: RosterWithAssignments['slots'];
    if (event.slotConfig) {
      slots = this.slotConfigFromEvent(
        event.slotConfig as Record<string, unknown>,
      );
    } else if (event.maxAttendees) {
      // Count how many are actually benched to size the bench section
      const benchedCount = assigned.filter((a) => a.slot === 'bench').length;
      const benchSlots = Math.max(benchedCount, 2);
      slots = { player: event.maxAttendees, bench: benchSlots };
    } else {
      slots = await this.getSlotConfigFromGenre(event.gameId);
    }

    return {
      eventId,
      pool,
      assignments: assigned,
      slots,
    };
  }

  /**
   * Extract slot counts from a per-event slot_config jsonb value.
   * Converts the stored { type, tank, healer, dps, flex, player, bench }
   * into the RosterWithAssignments['slots'] shape (role counts only).
   */
  private slotConfigFromEvent(
    config: Record<string, unknown>,
  ): RosterWithAssignments['slots'] {
    const type = config.type as string;
    if (type === 'mmo') {
      return {
        tank: (config.tank as number) ?? 2,
        healer: (config.healer as number) ?? 4,
        dps: (config.dps as number) ?? 14,
        flex: (config.flex as number) ?? 5,
        bench: (config.bench as number) ?? 0,
      };
    }
    // Generic
    return {
      player: (config.player as number) ?? 10,
      bench: (config.bench as number) ?? 5,
    };
  }

  /**
   * ROK-183: Get slot configuration based on game type (fallback).
   * Uses IGDB genre data to detect MMO games (genre 36 = MMORPG).
   * MMO games use role-based slots (tank/healer/dps/flex).
   * Other games use generic player slots.
   */
  private async getSlotConfigFromGenre(
    gameId: number | null,
  ): Promise<RosterWithAssignments['slots']> {
    // IGDB genre ID for "Massively Multiplayer Online (MMO)"
    const MMO_GENRE_ID = 36;

    if (!gameId) {
      // No game specified - default to generic slots
      return { player: 10, bench: 5 };
    }

    // Query game genres from database
    const [game] = await this.db
      .select({ genres: schema.games.genres })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);

    const genres = (game?.genres as number[]) ?? [];
    const isMMO = genres.includes(MMO_GENRE_ID);

    if (isMMO) {
      // MMO: role-based slots
      return {
        tank: 2,
        healer: 4,
        dps: 14,
        flex: 5,
      };
    }

    // Generic games: player slots
    return {
      player: 10,
      bench: 5,
    };
  }

  /**
   * ROK-409: Clean up stale PUG slots when a user signs up for an event.
   * Matches by discordId or discordUsername on unclaimed slots for this event.
   */
  private async cleanupMatchingPugSlots(
    eventId: number,
    userId: number,
  ): Promise<void> {
    const [user] = await this.db
      .select({
        discordId: schema.users.discordId,
        username: schema.users.username,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.discordId) return;

    const result = await this.db
      .delete(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.eventId, eventId),
          or(
            eq(schema.pugSlots.discordUserId, user.discordId),
            eq(schema.pugSlots.discordUsername, user.username),
          ),
        ),
      )
      .returning({ id: schema.pugSlots.id });

    if (result.length > 0) {
      this.logger.log(
        'Cleaned up %d stale PUG slot(s) for user %d (discord: %s) on event %d',
        result.length,
        userId,
        user.discordId,
        eventId,
      );
    }
  }

  /**
   * ROK-390: Detect role changes between old and new roster assignments,
   * and send notifications to affected players.
   * - Role changes (e.g., healer → DPS): roster_reassigned notification
   * - Bench → non-bench: bench_promoted notification
   * - Non-bench → bench: roster_reassigned notification
   * - Same-role position changes (DPS 1 → DPS 5): silent (no notification)
   * - Anonymous Discord participants: skipped (no userId)
   */
  private async notifyRoleChanges(
    eventId: number,
    eventTitle: string,
    newAssignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
    oldRoleBySignupId: Map<number, string | null>,
  ): Promise<void> {
    for (const assignment of newAssignments) {
      // Skip anonymous participants (no RL user to notify)
      if (!assignment.userId) continue;

      const signup = signupByUserId.get(assignment.userId);
      if (!signup) continue;

      const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
      const newRole = assignment.slot;

      // No change in role → silent (same-role position changes)
      if (oldRole === newRole) continue;

      // No previous assignment (newly assigned) → not a reassign notification
      if (oldRole === null) continue;

      // No new role (moved to unassigned pool) → not a reassign notification
      if (newRole === null) continue;

      const formatLabel = (r: string) =>
        r.charAt(0).toUpperCase() + r.slice(1);

      if (oldRole === 'bench' && newRole !== 'bench') {
        // Promoted from bench → use existing bench_promoted type
        await this.notificationService.create({
          userId: assignment.userId,
          type: 'bench_promoted',
          title: 'Promoted from Bench',
          message: `You've been moved from bench to ${formatLabel(newRole)} for ${eventTitle}`,
          payload: { eventId },
        });
      } else {
        // Role change or moved to bench → roster_reassigned
        const oldLabel = formatLabel(oldRole);
        const newLabel = formatLabel(newRole);
        const isBenched = newRole === 'bench';

        await this.notificationService.create({
          userId: assignment.userId,
          type: 'roster_reassigned',
          title: isBenched ? 'Moved to Bench' : 'Role Changed',
          message: isBenched
            ? `You've been moved from ${oldLabel} to bench for ${eventTitle}`
            : `Your role changed from ${oldLabel} to ${newLabel} for ${eventTitle}`,
          payload: { eventId, oldRole, newRole },
        });
      }
    }
  }

  /**
   * Emit a signup lifecycle event for Discord embed sync (ROK-119).
   * Fires asynchronously — failures are logged but do not block the caller.
   */
  private emitSignupEvent(eventName: string, payload: SignupEventPayload): void {
    this.eventEmitter.emit(eventName, payload);
  }

  /**
   * Build roster assignment response from signup data.
   * Supports both RL members and anonymous Discord participants (ROK-137).
   */
  private buildRosterAssignmentResponse(
    row: {
      event_signups: typeof schema.eventSignups.$inferSelect;
      users: typeof schema.users.$inferSelect | null;
      characters: typeof schema.characters.$inferSelect | null;
    },
    assignment?: typeof schema.rosterAssignments.$inferSelect,
  ): RosterAssignmentResponse {
    const isAnonymous = !row.event_signups.userId;
    return {
      id: assignment?.id ?? 0,
      signupId: row.event_signups.id,
      userId: row.users?.id ?? 0,
      discordId: isAnonymous
        ? (row.event_signups.discordUserId ?? '')
        : (row.users?.discordId ?? ''),
      username: isAnonymous
        ? (row.event_signups.discordUsername ?? 'Discord User')
        : (row.users?.username ?? 'Unknown'),
      avatar: isAnonymous
        ? (row.event_signups.discordAvatarHash ?? null)
        : (row.users?.avatar ?? null),
      customAvatarUrl: row.users?.customAvatarUrl ?? null,
      slot: (assignment?.role as RosterRole) ?? null,
      position: assignment?.position ?? 0,
      isOverride: assignment?.isOverride === 1,
      character: row.characters
        ? {
            id: row.characters.id,
            name: row.characters.name,
            className: row.characters.class,
            role: row.characters.roleOverride ?? row.characters.role,
            avatarUrl: row.characters.avatarUrl,
          }
        : null,
    };
  }
}
