import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  SignupResponseDto,
  EventRosterDto,
  CreateSignupDto,
  ConfirmSignupDto,
  SignupCharacterDto,
  ConfirmationStatus,
  UpdateRosterDto,
  RosterWithAssignments,
  RosterAssignmentResponse,
  RosterRole,
} from '@raid-ledger/contract';

/**
 * Service for managing event signups (FR-006) and character confirmation (ROK-131).
 */
@Injectable()
export class SignupsService {
  private readonly logger = new Logger(SignupsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
  ) { }

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

    // Try to insert first (handles race conditions gracefully)
    try {
      const [signup] = await this.db
        .insert(schema.eventSignups)
        .values({
          eventId,
          userId,
          note: dto?.note ?? null,
          confirmationStatus: 'pending', // ROK-131 AC-1
        })
        .returning();

      this.logger.log(`User ${userId} signed up for event ${eventId}`);

      // ROK-183: If slot preference provided, create roster assignment immediately
      if (dto?.slotRole && dto?.slotPosition) {
        await this.db.insert(schema.rosterAssignments).values({
          eventId,
          signupId: signup.id,
          role: dto.slotRole,
          position: dto.slotPosition,
          isOverride: 0,
        });
        this.logger.log(`Assigned user ${userId} to ${dto.slotRole} slot ${dto.slotPosition}`);
      }

      return this.buildSignupResponse(signup, user, null);
    } catch (error: unknown) {
      // Handle unique constraint violation (concurrent signup or already signed up)
      if (
        error instanceof Error &&
        error.message.includes('unique_event_user')
      ) {
        // Return existing signup (idempotent behavior - AC-4)
        const existing = await this.db
          .select()
          .from(schema.eventSignups)
          .where(
            and(
              eq(schema.eventSignups.eventId, eventId),
              eq(schema.eventSignups.userId, userId),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          // Fetch character if exists
          const character = existing[0].characterId
            ? await this.getCharacterById(existing[0].characterId)
            : null;
          return this.buildSignupResponse(existing[0], user, character);
        }
      }
      throw error;
    }
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

    return this.buildSignupResponse(updated, user, character);
  }

  /**
   * Cancel a user's signup for an event.
   * @param eventId - Event to cancel signup for
   * @param userId - User canceling
   * @throws NotFoundException if signup doesn't exist
   */
  async cancel(eventId: number, userId: number): Promise<void> {
    const result = await this.db
      .delete(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
        ),
      )
      .returning();

    if (result.length === 0) {
      throw new NotFoundException(
        `Signup not found for user ${userId} on event ${eventId}`,
      );
    }

    this.logger.log(`User ${userId} canceled signup for event ${eventId}`);
  }

  /**
   * Get the roster (all signups) for an event.
   * Includes character data for confirmed signups (ROK-131 AC-6).
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

    const signupResponses: SignupResponseDto[] = signups.map((row) => ({
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
      character: row.characters ? this.buildCharacterDto(row.characters) : null,
      confirmationStatus: row.event_signups
        .confirmationStatus as ConfirmationStatus,
    }));

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
    return {
      id: character.id,
      name: character.name,
      class: character.class,
      spec: character.spec,
      role: character.role as 'tank' | 'healer' | 'dps' | null,
      isMain: character.isMain,
      itemLevel: character.itemLevel,
      avatarUrl: character.avatarUrl,
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
    };
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
        'Only event creator or admin can update roster',
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
    }

    this.logger.log(
      `Roster updated for event ${eventId}: ${dto.assignments.length} assignments`,
    );

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

    return {
      eventId,
      pool,
      assignments: assigned,
      slots: await this.getSlotConfig(event.gameId),
    };
  }

  /**
   * ROK-183: Get slot configuration based on game type.
   * Uses IGDB genre data to detect MMO games (genre 36 = MMORPG).
   * MMO games use role-based slots (tank/healer/dps/flex).
   * Other games use generic player slots.
   */
  private async getSlotConfig(gameId: string | null): Promise<RosterWithAssignments['slots']> {
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
      .where(eq(schema.games.igdbId, parseInt(gameId, 10)))
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
   * Build roster assignment response from signup data.
   */
  private buildRosterAssignmentResponse(
    row: {
      event_signups: typeof schema.eventSignups.$inferSelect;
      users: typeof schema.users.$inferSelect | null;
      characters: typeof schema.characters.$inferSelect | null;
    },
    assignment?: typeof schema.rosterAssignments.$inferSelect,
  ): RosterAssignmentResponse {
    return {
      id: assignment?.id ?? 0,
      signupId: row.event_signups.id,
      userId: row.users?.id ?? 0,
      discordId: row.users?.discordId ?? '',
      username: row.users?.username ?? 'Unknown',
      avatar: row.users?.avatar ?? null,
      slot: (assignment?.role as RosterRole) ?? null,
      position: assignment?.position ?? 0,
      isOverride: assignment?.isOverride === 1,
      character: row.characters
        ? {
          id: row.characters.id,
          name: row.characters.name,
          className: row.characters.class,
          role: row.characters.role,
        }
        : null,
    };
  }
}
