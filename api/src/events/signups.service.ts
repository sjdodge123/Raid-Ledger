import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, or, sql, isNull, ne, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import { RosterNotificationBufferService } from '../notifications/roster-notification-buffer.service';
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
  AttendanceStatus,
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
    private rosterNotificationBuffer: RosterNotificationBufferService,
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
    const [eventRow] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!eventRow)
      throw new NotFoundException(`Event with ID ${eventId} not found`);

    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (dto?.characterId)
      await this.verifyCharacterOwnership(dto.characterId, userId);

    const result = await this.db.transaction((tx) =>
      this.signupTxBody(tx, eventRow, eventId, userId, dto, user),
    );

    this.fireCleanupPugSlots(eventId, userId);
    if (result.isDuplicate) return result.response;

    this.emitSignupEvent(SIGNUP_EVENTS.CREATED, {
      eventId,
      userId,
      signupId: result.signup.id,
      action: 'signup_created',
    });
    this.rosterNotificationBuffer.bufferJoin(eventId, userId);

    const character = dto?.characterId
      ? await this.getCharacterById(dto.characterId)
      : null;
    return this.buildSignupResponse(result.signup, user, character);
  }

  private fireCleanupPugSlots(eventId: number, userId: number) {
    this.cleanupMatchingPugSlots(eventId, userId).catch((err) => {
      this.logger.warn(
        'Failed to cleanup PUG slots for user %d on event %d: %s',
        userId,
        eventId,
        err instanceof Error ? err.message : 'Unknown error',
      );
    });
  }

  private async signupTxBody(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    userId: number,
    dto: CreateSignupDto | undefined,
    user: typeof schema.users.$inferSelect | undefined,
  ) {
    const autoBench = await this.checkAutoBench(tx, eventRow, eventId, dto);
    const hasCharacter = !!dto?.characterId;
    const rows = await this.insertSignupRow(
      tx,
      eventId,
      userId,
      dto,
      hasCharacter,
    );

    if (rows.length === 0) {
      return this.handleDuplicateSignup(
        tx,
        eventRow,
        eventId,
        userId,
        dto,
        autoBench,
        hasCharacter,
        user,
      );
    }
    return this.handleNewSignup(
      tx,
      eventRow,
      eventId,
      userId,
      rows[0],
      dto,
      autoBench,
    );
  }

  private async checkAutoBench(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    dto?: CreateSignupDto,
  ) {
    if (!eventRow.maxAttendees || dto?.slotRole === 'bench') return false;
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
    return Number(count) >= eventRow.maxAttendees;
  }

  private async insertSignupRow(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    userId: number,
    dto?: CreateSignupDto,
    hasCharacter = false,
  ) {
    return tx
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId,
        note: dto?.note ?? null,
        characterId: dto?.characterId ?? null,
        confirmationStatus: hasCharacter ? 'confirmed' : 'pending',
        status: 'signed_up',
        preferredRoles: dto?.preferredRoles ?? null,
      })
      .onConflictDoNothing({
        target: [schema.eventSignups.eventId, schema.eventSignups.userId],
      })
      .returning();
  }

  private async handleDuplicateSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    userId: number,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
    hasCharacter: boolean,
    user: typeof schema.users.$inferSelect | undefined,
  ) {
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

    await this.reactivateIfCancelled(tx, existing, dto, hasCharacter);
    await this.updatePreferredRolesIfNeeded(tx, existing, dto);

    const [existingAssignment] = await tx
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, existing.id))
      .limit(1);
    if (!existingAssignment) {
      await this.assignUnassignedDuplicate(
        tx,
        eventRow,
        eventId,
        existing,
        dto,
        autoBench,
      );
    }

    const character = existing.characterId
      ? await this.getCharacterById(existing.characterId)
      : null;
    return {
      isDuplicate: true as const,
      response: this.buildSignupResponse(existing, user, character),
    };
  }

  private async reactivateIfCancelled(
    tx: PostgresJsDatabase<typeof schema>,
    existing: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    hasCharacter: boolean,
  ) {
    if (
      existing.status !== 'roached_out' &&
      existing.status !== 'declined' &&
      existing.status !== 'departed'
    )
      return;
    const reactivated = hasCharacter ? 'confirmed' : 'pending';
    await tx
      .update(schema.eventSignups)
      .set({
        status: 'signed_up',
        confirmationStatus: reactivated,
        note: dto?.note ?? existing.note,
        characterId: dto?.characterId ?? null,
        preferredRoles: dto?.preferredRoles ?? null,
        attendanceStatus: null,
        attendanceRecordedAt: null,
        roachedOutAt: null,
      })
      .where(eq(schema.eventSignups.id, existing.id));
    Object.assign(existing, {
      status: 'signed_up',
      confirmationStatus: reactivated,
      note: dto?.note ?? existing.note,
      characterId: dto?.characterId ?? null,
      preferredRoles: dto?.preferredRoles ?? null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      roachedOutAt: null,
    });
  }

  private async updatePreferredRolesIfNeeded(
    tx: PostgresJsDatabase<typeof schema>,
    existing: typeof schema.eventSignups.$inferSelect,
    dto?: CreateSignupDto,
  ) {
    if (
      existing.status === 'roached_out' ||
      existing.status === 'declined' ||
      existing.status === 'departed'
    )
      return;
    if (!dto?.preferredRoles || dto.preferredRoles.length === 0) return;
    await tx
      .update(schema.eventSignups)
      .set({ preferredRoles: dto.preferredRoles })
      .where(eq(schema.eventSignups.id, existing.id));
    existing.preferredRoles = dto.preferredRoles;
  }

  private async assignUnassignedDuplicate(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    existing: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
  ) {
    const shouldAutoAllocate = this.shouldUseAutoAllocation(
      eventRow,
      existing,
      dto,
      autoBench,
    );
    if (shouldAutoAllocate) {
      await this.runAutoAllocationForSignup(
        tx,
        eventRow,
        eventId,
        existing.id,
        dto,
      );
      await this.syncConfirmationStatus(tx, existing);
    } else {
      const confirmed = await this.assignDirectSlot(
        tx,
        eventRow,
        eventId,
        existing.id,
        dto,
        autoBench,
        `Re-assigned user ${existing.userId}`,
      );
      if (confirmed) existing.confirmationStatus = 'confirmed';
    }
  }

  private shouldUseAutoAllocation(
    eventRow: typeof schema.events.$inferSelect,
    signup: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
  ): boolean {
    const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type !== 'mmo' || autoBench || dto?.slotRole === 'bench')
      return false;
    const hasPrefs = signup.preferredRoles && signup.preferredRoles.length > 0;
    const hasSingleRole = !hasPrefs && !!dto?.slotRole;
    return hasPrefs || hasSingleRole;
  }

  private async runAutoAllocationForSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    signupId: number,
    dto?: CreateSignupDto,
  ) {
    const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
    if (dto?.slotRole) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [dto.slotRole] })
        .where(eq(schema.eventSignups.id, signupId));
    }
    await this.autoAllocateSignup(tx, eventId, signupId, slotConfig);
  }

  private async syncConfirmationStatus(
    tx: PostgresJsDatabase<typeof schema>,
    signup: typeof schema.eventSignups.$inferSelect,
  ) {
    const [refreshed] = await tx
      .select({ confirmationStatus: schema.eventSignups.confirmationStatus })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signup.id))
      .limit(1);
    if (refreshed) signup.confirmationStatus = refreshed.confirmationStatus;
  }

  private async assignDirectSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    signupId: number,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
    logPrefix: string,
  ): Promise<boolean> {
    const slotRole = autoBench
      ? 'bench'
      : (dto?.slotRole ??
        (await this.resolveGenericSlotRole(tx, eventRow, eventId)));
    if (!slotRole) return false;

    const position = await this.findNextPosition(
      tx,
      eventId,
      slotRole,
      dto?.slotPosition,
      autoBench,
    );
    await tx
      .insert(schema.rosterAssignments)
      .values({ eventId, signupId, role: slotRole, position, isOverride: 0 });

    if (slotRole !== 'bench') {
      await tx
        .update(schema.eventSignups)
        .set({ confirmationStatus: 'confirmed' })
        .where(eq(schema.eventSignups.id, signupId));
      await this.benchPromotionService.cancelPromotion(
        eventId,
        slotRole,
        position,
      );
    }
    this.logger.log(
      `${logPrefix} to ${slotRole} slot ${position}${autoBench ? ' (auto-benched)' : ''}`,
    );
    return slotRole !== 'bench';
  }

  private async findNextPosition(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    slotRole: string,
    explicitPosition?: number,
    autoBench = false,
  ) {
    if (!autoBench && explicitPosition) return explicitPosition;
    const positions = await tx
      .select({ position: schema.rosterAssignments.position })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, slotRole),
        ),
      );
    return positions.reduce((max, r) => Math.max(max, r.position), 0) + 1;
  }

  private async handleNewSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    userId: number,
    inserted: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
  ) {
    this.logger.log(`User ${userId} signed up for event ${eventId}`);
    const shouldAutoAllocate = this.shouldUseAutoAllocationNew(
      eventRow,
      dto,
      autoBench,
    );

    if (shouldAutoAllocate) {
      await this.runAutoAllocationForSignup(
        tx,
        eventRow,
        eventId,
        inserted.id,
        dto,
      );
      await this.syncConfirmationStatus(tx, inserted);
    } else {
      const confirmed = await this.assignDirectSlot(
        tx,
        eventRow,
        eventId,
        inserted.id,
        dto,
        autoBench,
        `Assigned user ${userId}`,
      );
      if (confirmed) inserted.confirmationStatus = 'confirmed';
    }

    await this.autoConfirmCreator(tx, eventRow, userId, inserted);
    return { isDuplicate: false as const, signup: inserted };
  }

  private shouldUseAutoAllocationNew(
    eventRow: typeof schema.events.$inferSelect,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
  ): boolean {
    const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type !== 'mmo' || autoBench || dto?.slotRole === 'bench')
      return false;
    const hasPrefs = dto?.preferredRoles && dto.preferredRoles.length > 0;
    const hasSingleRole = !hasPrefs && !!dto?.slotRole;
    return hasPrefs || hasSingleRole;
  }

  private async autoConfirmCreator(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    userId: number,
    inserted: typeof schema.eventSignups.$inferSelect,
  ) {
    if (
      eventRow.creatorId !== userId ||
      inserted.confirmationStatus === 'confirmed'
    )
      return;
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, inserted.id));
    inserted.confirmationStatus = 'confirmed';
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
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);

    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, dto.discordUserId))
      .limit(1);
    if (linkedUser) {
      return this.signup(eventId, linkedUser.id, {
        preferredRoles: dto.preferredRoles,
        slotRole: dto.role,
      });
    }

    const result = await this.db.transaction((tx) =>
      this.discordSignupTxBody(tx, event, eventId, dto),
    );

    this.emitSignupEvent(SIGNUP_EVENTS.CREATED, {
      eventId,
      signupId: result.id,
      action: 'discord_signup_created',
    });
    return this.buildAnonymousSignupResponse(result);
  }

  private async discordSignupTxBody(
    tx: PostgresJsDatabase<typeof schema>,
    event: typeof schema.events.$inferSelect,
    eventId: number,
    dto: CreateDiscordSignupDto,
  ) {
    const rows = await this.insertDiscordSignupRow(tx, eventId, dto);
    if (rows.length === 0) {
      return this.fetchExistingDiscordSignup(tx, eventId, dto.discordUserId);
    }
    const [inserted] = rows;
    await this.allocateDiscordSignupSlot(tx, event, eventId, inserted.id, dto);
    this.logger.log(
      `Anonymous Discord user ${dto.discordUsername} (${dto.discordUserId}) signed up for event ${eventId}`,
    );
    return inserted;
  }

  private async insertDiscordSignupRow(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    dto: CreateDiscordSignupDto,
  ) {
    return tx
      .insert(schema.eventSignups)
      .values({
        eventId,
        userId: null,
        discordUserId: dto.discordUserId,
        discordUsername: dto.discordUsername,
        discordAvatarHash: dto.discordAvatarHash ?? null,
        confirmationStatus: 'confirmed',
        status: dto.status ?? 'signed_up',
        preferredRoles: dto.preferredRoles ?? null,
      })
      .onConflictDoNothing({
        target: [
          schema.eventSignups.eventId,
          schema.eventSignups.discordUserId,
        ],
      })
      .returning();
  }

  private async fetchExistingDiscordSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    discordUserId: string,
  ) {
    const [existing] = await tx
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
        ),
      )
      .limit(1);
    return existing;
  }

  private async allocateDiscordSignupSlot(
    tx: PostgresJsDatabase<typeof schema>,
    event: typeof schema.events.$inferSelect,
    eventId: number,
    signupId: number,
    dto: CreateDiscordSignupDto,
  ) {
    const slotConfig = event.slotConfig as Record<string, unknown> | null;
    const isMMO = slotConfig?.type === 'mmo';
    const hasPrefs = dto.preferredRoles && dto.preferredRoles.length > 0;
    const hasSingleRole = !hasPrefs && dto.role;

    if (isMMO && (hasPrefs || hasSingleRole)) {
      if (hasSingleRole && dto.role) {
        await tx
          .update(schema.eventSignups)
          .set({ preferredRoles: [dto.role] })
          .where(eq(schema.eventSignups.id, signupId));
      }
      await this.autoAllocateSignup(tx, eventId, signupId, slotConfig);
      return;
    }

    const assignRole =
      !isMMO || (!hasPrefs && !hasSingleRole)
        ? (dto.role ?? (await this.resolveGenericSlotRole(tx, event, eventId)))
        : null;
    if (!assignRole) return;

    const position = await this.findNextPosition(tx, eventId, assignRole);
    await tx.insert(schema.rosterAssignments).values({
      eventId,
      signupId,
      role: assignRole,
      position,
      isOverride: 0,
    });
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
    const signup = await this.findSignupByIdentifier(eventId, signupIdentifier);

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

    if (dto.status === 'tentative') {
      this.checkTentativeDisplacement(eventId, signup.id).catch(
        (err: unknown) => {
          this.logger.warn(
            `ROK-459: Failed tentative displacement check: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        },
      );
    }

    return this.buildStatusUpdateResponse(updated);
  }

  private async findSignupByIdentifier(
    eventId: number,
    identifier: { userId?: number; discordUserId?: string },
  ) {
    const conditions = [eq(schema.eventSignups.eventId, eventId)];
    if (identifier.userId)
      conditions.push(eq(schema.eventSignups.userId, identifier.userId));
    else if (identifier.discordUserId)
      conditions.push(
        eq(schema.eventSignups.discordUserId, identifier.discordUserId),
      );
    else
      throw new BadRequestException(
        'Either userId or discordUserId must be provided',
      );

    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(and(...conditions))
      .limit(1);
    if (!signup) throw new NotFoundException('Signup not found');
    return signup;
  }

  private async buildStatusUpdateResponse(
    updated: typeof schema.eventSignups.$inferSelect,
  ): Promise<SignupResponseDto> {
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
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) {
      return this.findLinkedUserSignup(eventId, linkedUser);
    }
    return this.findAnonymousSignup(eventId, discordUserId);
  }

  private async findLinkedUserSignup(
    eventId: number,
    linkedUser: typeof schema.users.$inferSelect,
  ): Promise<SignupResponseDto | null> {
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

  private async findAnonymousSignup(
    eventId: number,
    discordUserId: string,
  ): Promise<SignupResponseDto | null> {
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
    const [linkedUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);

    if (linkedUser) return this.cancel(eventId, linkedUser.id);

    const signup = await this.findActiveAnonymousSignup(eventId, discordUserId);
    const [event] = await this.db
      .select({ duration: schema.events.duration })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    const { cancelStatus, isGracefulDecline, now } = determineCancelStatus(
      event?.duration as [Date, Date] | null,
    );

    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id));
    await this.db
      .update(schema.eventSignups)
      .set({
        status: cancelStatus,
        roachedOutAt: isGracefulDecline ? null : now,
      })
      .where(eq(schema.eventSignups.id, signup.id));

    this.logger.log(
      `Anonymous Discord user ${discordUserId} canceled signup for event ${eventId} (${cancelStatus})`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      signupId: signup.id,
      action: 'discord_signup_cancelled',
    });
  }

  private async findActiveAnonymousSignup(
    eventId: number,
    discordUserId: string,
  ) {
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, discordUserId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'declined'),
          ne(schema.eventSignups.status, 'departed'),
        ),
      )
      .limit(1);
    if (!signup)
      throw new NotFoundException(
        `Signup not found for Discord user ${discordUserId} on event ${eventId}`,
      );
    return signup;
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
    const signup = await this.fetchAndVerifySignup(eventId, signupId, userId);
    const character = await this.verifyCharacterOwnership(
      dto.characterId,
      userId,
    );

    const newStatus: ConfirmationStatus =
      signup.confirmationStatus === 'pending' ? 'confirmed' : 'changed';

    const [updated] = await this.db
      .update(schema.eventSignups)
      .set({ characterId: dto.characterId, confirmationStatus: newStatus })
      .where(eq(schema.eventSignups.id, signupId))
      .returning();

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

  private async fetchAndVerifySignup(
    eventId: number,
    signupId: number,
    userId: number,
  ) {
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
    if (!signup)
      throw new NotFoundException(
        `Signup ${signupId} not found for event ${eventId}`,
      );
    if (signup.userId !== userId)
      throw new ForbiddenException('You can only confirm your own signup');
    return signup;
  }

  private async verifyCharacterOwnership(characterId: string, userId: number) {
    const [character] = await this.db
      .select()
      .from(schema.characters)
      .where(
        and(
          eq(schema.characters.id, characterId),
          eq(schema.characters.userId, userId),
        ),
      )
      .limit(1);
    if (!character)
      throw new BadRequestException(
        'Character not found or does not belong to you',
      );
    return character;
  }

  /**
   * Cancel a user's signup for an event.
   * @param eventId - Event to cancel signup for
   * @param userId - User canceling
   * @throws NotFoundException if signup doesn't exist
   */
  async cancel(eventId: number, userId: number): Promise<void> {
    const signup = await this.findActiveSignupForCancel(eventId, userId);

    const [event] = await this.db
      .select({ duration: schema.events.duration })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    const { cancelStatus, isGracefulDecline, now } = determineCancelStatus(
      event?.duration as [Date, Date] | null,
    );

    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);

    const notifyData = assignment
      ? await this.gatherCancelNotifyData(eventId, userId, assignment.role)
      : null;

    await this.executeCancelSignup(
      signup.id,
      assignment,
      cancelStatus,
      isGracefulDecline,
      now,
    );

    this.logger.log(
      `User ${userId} canceled signup for event ${eventId} (${cancelStatus})`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'signup_cancelled',
    });

    if (notifyData && assignment) {
      await this.handleVacatedSlot(eventId, userId, assignment, notifyData);
    }
  }

  private async findActiveSignupForCancel(eventId: number, userId: number) {
    const [directSignup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.userId, userId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'declined'),
          ne(schema.eventSignups.status, 'departed'),
        ),
      )
      .limit(1);

    const signup =
      directSignup ??
      (await this.findUnclaimedAnonymousSignup(eventId, userId));
    if (!signup)
      throw new NotFoundException(
        `Signup not found for user ${userId} on event ${eventId}`,
      );
    return signup;
  }

  private async findUnclaimedAnonymousSignup(eventId: number, userId: number) {
    const [user] = await this.db
      .select({ discordId: schema.users.discordId })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user?.discordId) return undefined;
    const [signup] = await this.db
      .select()
      .from(schema.eventSignups)
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.discordUserId, user.discordId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'declined'),
          ne(schema.eventSignups.status, 'departed'),
        ),
      )
      .limit(1);
    return signup;
  }

  private async gatherCancelNotifyData(
    eventId: number,
    userId: number,
    role: string | null,
  ) {
    const [[evt], [user]] = await Promise.all([
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
    return {
      creatorId: evt.creatorId,
      eventTitle: evt.title,
      role,
      displayName: user?.username ?? 'Unknown',
    };
  }

  private async executeCancelSignup(
    signupId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect | undefined,
    cancelStatus: string,
    isGracefulDecline: boolean,
    now: Date,
  ): Promise<void> {
    if (assignment) {
      await this.db
        .delete(schema.rosterAssignments)
        .where(eq(schema.rosterAssignments.signupId, signupId));
    }
    await this.db
      .update(schema.eventSignups)
      .set({
        status: cancelStatus,
        roachedOutAt: isGracefulDecline ? null : now,
      })
      .where(eq(schema.eventSignups.id, signupId));
  }

  private async handleVacatedSlot(
    eventId: number,
    userId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect,
    notifyData: {
      creatorId: number;
      eventTitle: string;
      role: string | null;
      displayName: string;
    },
  ): Promise<void> {
    this.rosterNotificationBuffer.bufferLeave({
      organizerId: notifyData.creatorId,
      eventId,
      eventTitle: notifyData.eventTitle,
      userId,
      displayName: notifyData.displayName,
      vacatedRole: notifyData.role ?? 'assigned',
    });

    if (assignment.role && assignment.role !== 'bench') {
      if (await this.benchPromotionService.isEligible(eventId)) {
        await this.benchPromotionService.schedulePromotion(
          eventId,
          assignment.role,
          assignment.position,
        );
      }
      this.reslotTentativePlayer(
        eventId,
        assignment.role,
        assignment.position,
      ).catch((err: unknown) => {
        this.logger.warn(
          `ROK-459: Failed tentative reslot check: ${err instanceof Error ? err.message : 'Unknown error'}`,
        );
      });
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
    const signups = await this.fetchRosterSignups(eventId);

    if (signups.length === 0) {
      await this.verifyEventExists(eventId);
    }

    const signupResponses = signups.map((row) => this.mapRosterRow(row));

    return { eventId, signups: signupResponses, count: signupResponses.length };
  }

  private async fetchRosterSignups(eventId: number) {
    return this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'declined'),
        ),
      )
      .orderBy(schema.eventSignups.signedUpAt);
  }

  private async verifyEventExists(eventId: number) {
    const [event] = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);
  }

  private mapRosterRow(row: {
    event_signups: typeof schema.eventSignups.$inferSelect;
    users: typeof schema.users.$inferSelect | null;
    characters: typeof schema.characters.$inferSelect | null;
  }): SignupResponseDto {
    if (!row.event_signups.userId) {
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
      character: row.characters ? this.buildCharacterDto(row.characters) : null,
      confirmationStatus: row.event_signups
        .confirmationStatus as ConfirmationStatus,
      status: (row.event_signups.status as SignupStatus) ?? 'signed_up',
      preferredRoles:
        (row.event_signups.preferredRoles as
          | ('tank' | 'healer' | 'dps')[]
          | null) ?? null,
      attendanceStatus:
        (row.event_signups.attendanceStatus as AttendanceStatus) ?? null,
      attendanceRecordedAt:
        row.event_signups.attendanceRecordedAt?.toISOString() ?? null,
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
      preferredRoles:
        (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
      attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
      attendanceRecordedAt: signup.attendanceRecordedAt?.toISOString() ?? null,
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
      preferredRoles:
        (signup.preferredRoles as ('tank' | 'healer' | 'dps')[] | null) ?? null,
      attendanceStatus: (signup.attendanceStatus as AttendanceStatus) ?? null,
      attendanceRecordedAt: signup.attendanceRecordedAt?.toISOString() ?? null,
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
    const { signup, assignment } = await this.findUserAssignment(
      eventId,
      userId,
    );
    const notifyData = await this.gatherCancelNotifyData(
      eventId,
      userId,
      assignment.role,
    );

    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.id, assignment.id));

    this.logger.log(
      `User ${userId} self-unassigned from ${assignment.role} slot for event ${eventId}`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      userId,
      signupId: signup.id,
      action: 'self_unassigned',
    });

    this.rosterNotificationBuffer.bufferLeave({
      organizerId: notifyData.creatorId,
      eventId,
      eventTitle: notifyData.eventTitle,
      userId,
      displayName: notifyData.displayName,
      vacatedRole: assignment.role ?? 'assigned',
    });

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

  private async findUserAssignment(eventId: number, userId: number) {
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
    if (!signup)
      throw new NotFoundException(
        `Signup not found for user ${userId} on event ${eventId}`,
      );

    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);
    if (!assignment)
      throw new NotFoundException(
        `No roster assignment found for user ${userId} on event ${eventId}`,
      );

    return { signup, assignment };
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
    const event = await this.verifyAdminPermission(
      eventId,
      requesterId,
      isAdmin,
    );
    const signup = await this.findSignupForEvent(eventId, signupId);
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id))
      .limit(1);

    await this.executeAdminRemove(eventId, signup);

    this.logger.log(
      `Admin ${requesterId} removed signup ${signupId} from event ${eventId}`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      userId: signup.userId,
      signupId: signup.id,
      action: 'admin_removed',
    });

    if (signup.userId) {
      await this.notifyRemovedUser(signup.userId, eventId, event.title);
    }
    await this.handleVacatedSlotAfterRemove(eventId, assignment);
  }

  private async verifyAdminPermission(
    eventId: number,
    requesterId: number,
    isAdmin: boolean,
    action = 'remove users from an event',
  ) {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    if (event.creatorId !== requesterId && !isAdmin) {
      throw new ForbiddenException(
        `Only event creator, admin, or operator can ${action}`,
      );
    }
    return event;
  }

  private async findSignupForEvent(eventId: number, signupId: number) {
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
    if (!signup)
      throw new NotFoundException(
        `Signup ${signupId} not found for event ${eventId}`,
      );
    return signup;
  }

  private async executeAdminRemove(
    eventId: number,
    signup: typeof schema.eventSignups.$inferSelect,
  ) {
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
    await this.db
      .delete(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signup.id));
  }

  private async notifyRemovedUser(
    userId: number,
    eventId: number,
    eventTitle: string,
  ) {
    const extraPayload = await this.fetchNotificationContext(eventId);
    await this.notificationService.create({
      userId,
      type: 'slot_vacated',
      title: 'Removed from Event',
      message: `You were removed from ${eventTitle}`,
      payload: { eventId, ...extraPayload },
    });
  }

  private async handleVacatedSlotAfterRemove(
    eventId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect | undefined,
  ) {
    if (!assignment?.role || assignment.role === 'bench') return;

    if (await this.benchPromotionService.isEligible(eventId)) {
      await this.benchPromotionService.schedulePromotion(
        eventId,
        assignment.role,
        assignment.position,
      );
    }
    this.reslotTentativePlayer(
      eventId,
      assignment.role,
      assignment.position,
    ).catch((err: unknown) => {
      this.logger.warn(
        `ROK-459: Failed tentative reslot check (admin remove): ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    });
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
    const event = await this.verifyAdminPermission(
      eventId,
      userId,
      isAdmin,
      'update roster',
    );
    const signupByUserId = await this.validateRosterAssignments(
      eventId,
      dto.assignments,
    );
    const oldRoleBySignupId = await this.captureOldAssignments(eventId);

    await this.replaceRosterAssignments(
      eventId,
      dto.assignments,
      signupByUserId,
    );

    this.logger.log(
      `Roster updated for event ${eventId}: ${dto.assignments.length} assignments`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      action: 'roster_updated',
    });

    this.fireRosterNotifications(
      eventId,
      event.title,
      dto.assignments,
      signupByUserId,
      oldRoleBySignupId,
    );

    return this.getRosterWithAssignments(eventId);
  }

  private async validateRosterAssignments(
    eventId: number,
    assignments: UpdateRosterDto['assignments'],
  ) {
    const signups = await this.db
      .select()
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));
    const signupByUserId = new Map(signups.map((s) => [s.userId, s]));
    for (const a of assignments) {
      if (!signupByUserId.get(a.userId)) {
        throw new BadRequestException(
          `User ${a.userId} is not signed up for this event`,
        );
      }
    }
    return signupByUserId;
  }

  private async captureOldAssignments(eventId: number) {
    const old = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));
    return new Map(old.map((a) => [a.signupId, a.role]));
  }

  private async replaceRosterAssignments(
    eventId: number,
    assignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  ) {
    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));
    await this.updateCharacterOverrides(assignments, signupByUserId);
    if (assignments.length > 0) {
      await this.insertNewAssignments(eventId, assignments, signupByUserId);
    }
  }

  private async updateCharacterOverrides(
    assignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  ) {
    for (const a of assignments) {
      if (!a.characterId) continue;
      const signup = signupByUserId.get(a.userId);
      if (signup) {
        await this.db
          .update(schema.eventSignups)
          .set({ characterId: a.characterId, confirmationStatus: 'confirmed' })
          .where(eq(schema.eventSignups.id, signup.id));
      }
    }
  }

  private async insertNewAssignments(
    eventId: number,
    assignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  ) {
    const values = assignments.map((a) => ({
      eventId,
      signupId: a.signupId ?? signupByUserId.get(a.userId)!.id,
      role: a.slot,
      position: a.position,
      isOverride: a.isOverride ? 1 : 0,
    }));
    await this.db.insert(schema.rosterAssignments).values(values);
    await this.confirmNonBenchSignups(assignments, signupByUserId);
    await this.cancelBenchPromotionsForSlots(eventId, assignments);
  }

  private async confirmNonBenchSignups(
    assignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
  ) {
    const ids = assignments
      .filter((a) => a.slot && a.slot !== 'bench')
      .map((a) => signupByUserId.get(a.userId)!)
      .filter((s) => s.confirmationStatus === 'pending')
      .map((s) => s.id);
    if (ids.length > 0) {
      await this.db
        .update(schema.eventSignups)
        .set({ confirmationStatus: 'confirmed' })
        .where(inArray(schema.eventSignups.id, ids));
    }
  }

  private async cancelBenchPromotionsForSlots(
    eventId: number,
    assignments: UpdateRosterDto['assignments'],
  ) {
    for (const a of assignments) {
      if (a.slot && a.slot !== 'bench') {
        await this.benchPromotionService.cancelPromotion(
          eventId,
          a.slot,
          a.position,
        );
      }
    }
  }

  private fireRosterNotifications(
    eventId: number,
    eventTitle: string,
    assignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
    oldRoleBySignupId: Map<number, string | null>,
  ) {
    const logError = (msg: string) => (err: unknown) =>
      this.logger.warn(
        msg,
        err instanceof Error ? err.message : 'Unknown error',
      );
    this.notifyRoleChanges(
      eventId,
      eventTitle,
      assignments,
      signupByUserId,
      oldRoleBySignupId,
    ).catch(logError('Failed to send roster reassign notifications: %s'));
    this.notifyNewAssignments(
      eventId,
      eventTitle,
      assignments,
      signupByUserId,
      oldRoleBySignupId,
    ).catch(logError('Failed to send roster assignment notifications: %s'));
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
    const [eventResult, signupsWithAssignments] = await Promise.all([
      this.fetchEventForRoster(eventId),
      this.fetchSignupsWithAssignments(eventId),
    ]);

    const event = eventResult[0];
    if (!event)
      throw new NotFoundException(`Event with ID ${eventId} not found`);

    const { pool, assigned } = this.partitionAssignments(
      signupsWithAssignments,
    );
    const slots = await this.resolveSlotConfig(event, assigned);

    return { eventId, pool, assignments: assigned, slots };
  }

  private async fetchEventForRoster(eventId: number) {
    return this.db
      .select({
        id: schema.events.id,
        slotConfig: schema.events.slotConfig,
        maxAttendees: schema.events.maxAttendees,
        gameId: schema.events.gameId,
      })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
  }

  private async fetchSignupsWithAssignments(eventId: number) {
    return this.db
      .select()
      .from(schema.eventSignups)
      .leftJoin(schema.users, eq(schema.eventSignups.userId, schema.users.id))
      .leftJoin(
        schema.characters,
        eq(schema.eventSignups.characterId, schema.characters.id),
      )
      .leftJoin(
        schema.rosterAssignments,
        and(
          eq(schema.rosterAssignments.signupId, schema.eventSignups.id),
          eq(schema.rosterAssignments.eventId, eventId),
        ),
      )
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          ne(schema.eventSignups.status, 'roached_out'),
          ne(schema.eventSignups.status, 'declined'),
        ),
      )
      .orderBy(schema.eventSignups.signedUpAt);
  }

  private partitionAssignments(
    rows: Array<{
      event_signups: typeof schema.eventSignups.$inferSelect;
      users: typeof schema.users.$inferSelect | null;
      characters: typeof schema.characters.$inferSelect | null;
      roster_assignments: typeof schema.rosterAssignments.$inferSelect | null;
    }>,
  ) {
    const pool: RosterAssignmentResponse[] = [];
    const assigned: RosterAssignmentResponse[] = [];
    for (const row of rows) {
      const assignment = row.roster_assignments ?? undefined;
      const response = this.buildRosterAssignmentResponse(
        {
          event_signups: row.event_signups,
          users: row.users,
          characters: row.characters,
        },
        assignment,
      );
      (assignment ? assigned : pool).push(response);
    }
    return { pool, assigned };
  }

  private async resolveSlotConfig(
    event: {
      slotConfig: unknown;
      maxAttendees: number | null;
      gameId: number | null;
    },
    assigned: RosterAssignmentResponse[],
  ): Promise<RosterWithAssignments['slots']> {
    if (event.slotConfig)
      return this.slotConfigFromEvent(
        event.slotConfig as Record<string, unknown>,
      );
    if (event.maxAttendees) {
      const benchedCount = assigned.filter((a) => a.slot === 'bench').length;
      return { player: event.maxAttendees, bench: Math.max(benchedCount, 2) };
    }
    return this.getSlotConfigFromGenre(event.gameId);
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

    const result = await this.deletePugSlotsForUser(eventId, user);
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

  private async deletePugSlotsForUser(
    eventId: number,
    user: { discordId: string | null; username: string },
  ) {
    return this.db
      .delete(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.eventId, eventId),
          or(
            eq(schema.pugSlots.discordUserId, user.discordId!),
            eq(schema.pugSlots.discordUsername, user.username),
          ),
        ),
      )
      .returning({ id: schema.pugSlots.id });
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
    const extraPayload = await this.fetchNotificationContext(eventId);

    for (const assignment of newAssignments) {
      if (!assignment.userId) continue;
      const signup = signupByUserId.get(assignment.userId);
      if (!signup) continue;
      const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
      const newRole = assignment.slot;
      if (oldRole === newRole || oldRole === null || newRole === null) continue;

      await this.sendRoleChangeNotification(
        assignment.userId,
        eventId,
        eventTitle,
        oldRole,
        newRole,
        extraPayload,
      );
    }
  }

  private async sendRoleChangeNotification(
    userId: number,
    eventId: number,
    eventTitle: string,
    oldRole: string,
    newRole: string,
    extraPayload: Record<string, string>,
  ): Promise<void> {
    if (oldRole === 'bench' && newRole !== 'bench') {
      await this.notificationService.create({
        userId,
        type: 'bench_promoted',
        title: 'Promoted from Bench',
        message: `You've been moved from bench to ${formatRoleLabel(newRole)} for ${eventTitle}`,
        payload: { eventId, ...extraPayload },
      });
    } else {
      const isBenched = newRole === 'bench';
      await this.notificationService.create({
        userId,
        type: 'roster_reassigned',
        title: isBenched ? 'Moved to Bench' : 'Role Changed',
        message: isBenched
          ? `You've been moved from ${formatRoleLabel(oldRole)} to bench for ${eventTitle}`
          : `Your role changed from ${formatRoleLabel(oldRole)} to ${formatRoleLabel(newRole)} for ${eventTitle}`,
        payload: { eventId, oldRole, newRole, ...extraPayload },
      });
    }
  }

  /**
   * ROK-461: Notify players who were newly assigned to a slot (no previous assignment).
   * Sends an FYI notification so the player knows an admin placed them on the roster.
   */
  private async notifyNewAssignments(
    eventId: number,
    eventTitle: string,
    newAssignments: UpdateRosterDto['assignments'],
    signupByUserId: Map<number | null, typeof schema.eventSignups.$inferSelect>,
    oldRoleBySignupId: Map<number, string | null>,
  ): Promise<void> {
    const extraPayload = await this.fetchNotificationContext(eventId);

    for (const assignment of newAssignments) {
      if (!assignment.userId) continue;
      const signup = signupByUserId.get(assignment.userId);
      if (!signup) continue;
      const oldRole = oldRoleBySignupId.get(signup.id) ?? null;
      const newRole = assignment.slot;
      if (oldRole !== null || newRole === null) continue;

      const isGeneric = newRole === 'player';
      await this.notificationService.create({
        userId: assignment.userId,
        type: 'roster_reassigned',
        title: 'Roster Assignment',
        message: isGeneric
          ? `You've been assigned to the roster for ${eventTitle}`
          : `You've been assigned to the ${formatRoleLabel(newRole)} role for ${eventTitle}`,
        payload: { eventId, newRole, ...extraPayload },
      });
    }
  }

  /** Fetch Discord embed URL + voice channel once for use in notification payloads. */
  private async fetchNotificationContext(
    eventId: number,
  ): Promise<Record<string, string>> {
    const [discordUrl, voiceChannelId] = await Promise.all([
      this.notificationService.getDiscordEmbedUrl(eventId),
      this.notificationService.resolveVoiceChannelForEvent(eventId),
    ]);
    return {
      ...(discordUrl ? { discordUrl } : {}),
      ...(voiceChannelId ? { voiceChannelId } : {}),
    };
  }

  /**
   * ROK-596: Promote a bench player using the role calculation engine.
   * Removes the bench assignment and runs autoAllocateSignup to find the
   * optimal slot (including chain rearrangements).
   *
   * @returns Object with the resulting role/position and any warnings, or null if promotion failed.
   */
  async promoteFromBench(
    eventId: number,
    signupId: number,
  ): Promise<{
    role: string;
    position: number;
    username: string;
    chainMoves?: string[];
    warning?: string;
  } | null> {
    return this.db.transaction(async (tx) => {
      // 1. Get the event's slot config
      const [event] = await tx
        .select({ slotConfig: schema.events.slotConfig })
        .from(schema.events)
        .where(eq(schema.events.id, eventId))
        .limit(1);

      if (!event?.slotConfig) return null;

      const slotConfig = event.slotConfig as Record<string, unknown>;

      // 2. Get the signup's preferred roles and username
      const [signup] = await tx
        .select({
          preferredRoles: schema.eventSignups.preferredRoles,
          userId: schema.eventSignups.userId,
        })
        .from(schema.eventSignups)
        .where(eq(schema.eventSignups.id, signupId))
        .limit(1);

      if (!signup) return null;

      let username = 'Bench player';
      if (signup.userId) {
        const [user] = await tx
          .select({ username: schema.users.username })
          .from(schema.users)
          .where(eq(schema.users.id, signup.userId))
          .limit(1);
        if (user) username = user.username;
      }

      if (slotConfig.type !== 'mmo') {
        // Generic games: direct assign to first open 'player' slot
        return this.promoteGenericSlot(
          tx,
          eventId,
          signupId,
          slotConfig,
          username,
        );
      }

      // 3. Snapshot roster assignments before allocation to detect chain moves
      const beforeAssignments = await tx
        .select({
          id: schema.rosterAssignments.id,
          signupId: schema.rosterAssignments.signupId,
          role: schema.rosterAssignments.role,
          position: schema.rosterAssignments.position,
        })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            sql`${schema.rosterAssignments.role} != 'bench'`,
          ),
        );

      // 4. Delete the bench assignment
      await tx
        .delete(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            eq(schema.rosterAssignments.signupId, signupId),
            eq(schema.rosterAssignments.role, 'bench'),
          ),
        );

      // 5. Run the role calculation engine
      await this.autoAllocateSignup(tx, eventId, signupId, slotConfig);

      // 6. Check where they ended up
      const [newAssignment] = await tx
        .select({
          role: schema.rosterAssignments.role,
          position: schema.rosterAssignments.position,
        })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            eq(schema.rosterAssignments.signupId, signupId),
          ),
        )
        .limit(1);

      if (!newAssignment || newAssignment.role === 'bench') {
        // Allocation failed — put them back on bench
        if (!newAssignment) {
          await tx.insert(schema.rosterAssignments).values({
            eventId,
            signupId,
            role: 'bench',
            position: 1,
          });
        }
        return {
          role: 'bench',
          position: 1,
          username,
          warning: `Could not find a suitable roster slot for ${username} based on their preferred roles.`,
        };
      }

      // 7. Detect chain moves by comparing before/after roster state
      const afterAssignments = await tx
        .select({
          id: schema.rosterAssignments.id,
          signupId: schema.rosterAssignments.signupId,
          role: schema.rosterAssignments.role,
          position: schema.rosterAssignments.position,
        })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            sql`${schema.rosterAssignments.role} != 'bench'`,
          ),
        );

      const chainMoves = await this.detectChainMoves(
        tx,
        beforeAssignments,
        afterAssignments,
        signupId,
      );

      // 8. Build warning: promoted player's role mismatch + chain move details
      const prefs = (signup.preferredRoles as string[]) ?? [];
      const warnings: string[] = [];

      if (
        prefs.length > 0 &&
        newAssignment.role &&
        !prefs.includes(newAssignment.role)
      ) {
        warnings.push(
          `${username} was placed in **${newAssignment.role}** which is not in their preferred roles (${prefs.join(', ')}).`,
        );
      }

      for (const move of chainMoves) {
        warnings.push(
          `${move.username} moved from **${move.fromRole}** to **${move.toRole}** to accommodate the promotion.`,
        );
      }

      return {
        role: newAssignment.role ?? 'bench',
        position: newAssignment.position,
        username,
        chainMoves: chainMoves.map(
          (m) => `${m.username}: ${m.fromRole} → ${m.toRole}`,
        ),
        warning: warnings.length > 0 ? warnings.join('\n') : undefined,
      };
    });
  }

  /**
   * ROK-627: Promote a bench player in a generic (non-MMO) event.
   * Simply assigns to the first open 'player' slot.
   */
  private async promoteGenericSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    slotConfig: Record<string, unknown>,
    username: string,
  ): Promise<{
    role: string;
    position: number;
    username: string;
    chainMoves?: string[];
    warning?: string;
  } | null> {
    const maxPlayers = (slotConfig.player as number) ?? null;

    // Delete the bench assignment
    await tx
      .delete(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, signupId),
          eq(schema.rosterAssignments.role, 'bench'),
        ),
      );

    // Count current player slots and find first open position
    const currentPlayers = await tx
      .select({ position: schema.rosterAssignments.position })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, 'player'),
        ),
      );

    if (maxPlayers !== null && currentPlayers.length >= maxPlayers) {
      // All slots full — put back on bench
      await tx.insert(schema.rosterAssignments).values({
        eventId,
        signupId,
        role: 'bench',
        position: 1,
      });
      return {
        role: 'bench',
        position: 1,
        username,
        warning: `All player slots are full — ${username} remains on bench.`,
      };
    }

    // Find first gap in positions
    const occupied = new Set(currentPlayers.map((p) => p.position));
    let position = 1;
    while (occupied.has(position)) position++;

    await tx.insert(schema.rosterAssignments).values({
      eventId,
      signupId,
      role: 'player',
      position,
      isOverride: 0,
    });

    // Auto-confirm the promoted player
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, signupId));

    return {
      role: 'player',
      position,
      username,
    };
  }

  /**
   * ROK-627: Detect chain moves by comparing roster snapshots before and after
   * autoAllocateSignup. Returns details of players who were moved to different roles.
   */
  private async detectChainMoves(
    tx: PostgresJsDatabase<typeof schema>,
    before: Array<{
      id: number;
      signupId: number;
      role: string | null;
      position: number;
    }>,
    after: Array<{
      id: number;
      signupId: number;
      role: string | null;
      position: number;
    }>,
    excludeSignupId: number,
  ): Promise<
    Array<{
      signupId: number;
      username: string;
      fromRole: string;
      toRole: string;
    }>
  > {
    const moves: Array<{
      signupId: number;
      username: string;
      fromRole: string;
      toRole: string;
    }> = [];
    const beforeMap = new Map(before.map((a) => [a.signupId, a]));

    // Collect signupIds that actually changed roles
    const movedEntries: Array<{
      signupId: number;
      fromRole: string;
      toRole: string;
    }> = [];
    for (const afterEntry of after) {
      if (afterEntry.signupId === excludeSignupId) continue;
      const beforeEntry = beforeMap.get(afterEntry.signupId);
      if (!beforeEntry) continue;
      if (beforeEntry.role !== afterEntry.role) {
        movedEntries.push({
          signupId: afterEntry.signupId,
          fromRole: beforeEntry.role ?? 'unknown',
          toRole: afterEntry.role ?? 'unknown',
        });
      }
    }

    if (movedEntries.length === 0) return moves;

    // Batch-fetch signups for all moved players
    const movedSignupIds = movedEntries.map((m) => m.signupId);
    const signups = await tx
      .select({
        id: schema.eventSignups.id,
        userId: schema.eventSignups.userId,
        discordUsername: schema.eventSignups.discordUsername,
      })
      .from(schema.eventSignups)
      .where(inArray(schema.eventSignups.id, movedSignupIds));
    const signupMap = new Map(signups.map((s) => [s.id, s]));

    // Batch-fetch users for signups that need a username fallback
    const userIds = signups
      .filter((s) => !s.discordUsername && s.userId)
      .map((s) => s.userId!);
    const userMap = new Map<number, string>();
    if (userIds.length > 0) {
      const users = await tx
        .select({ id: schema.users.id, username: schema.users.username })
        .from(schema.users)
        .where(inArray(schema.users.id, userIds));
      for (const u of users) userMap.set(u.id, u.username);
    }

    for (const entry of movedEntries) {
      const signup = signupMap.get(entry.signupId);
      let moveUsername = 'Unknown';
      if (signup?.discordUsername) {
        moveUsername = signup.discordUsername;
      } else if (signup?.userId) {
        moveUsername = userMap.get(signup.userId) ?? 'Unknown';
      }

      moves.push({
        signupId: entry.signupId,
        username: moveUsername,
        fromRole: entry.fromRole,
        toRole: entry.toRole,
      });
    }

    return moves;
  }

  /**
   * ROK-452: Auto-allocate a new signup to the best available slot based on
   * preferred roles. Uses a greedy algorithm that prioritizes rigid players
   * (fewer preferred roles) and rearranges flexible players to maximize filled slots.
   *
   * Algorithm:
   * 1. Gather all current signups with their preferred roles and existing assignments
   * 2. Build a bipartite matching: player preferences vs available slots
   * 3. Assign rigid players first (1 preferred role), then flexible ones
   * 4. If needed, rearrange existing flexible players to accommodate rigid newcomers
   *
   * @param tx - Transaction handle
   * @param eventId - Event ID
   * @param newSignupId - The newly created signup ID to allocate
   * @param slotConfig - Event's slot configuration (MMO type)
   */
  private async autoAllocateSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    slotConfig: Record<string, unknown> | null,
  ): Promise<void> {
    // Get slot capacities from config
    const tankSlots = (slotConfig?.tank as number) ?? 2;
    const healerSlots = (slotConfig?.healer as number) ?? 4;
    const dpsSlots = (slotConfig?.dps as number) ?? 14;
    const roleCapacity: Record<string, number> = {
      tank: tankSlots,
      healer: healerSlots,
      dps: dpsSlots,
    };

    // Get all signups with preferred roles and status for this event
    const allSignups = await tx
      .select({
        id: schema.eventSignups.id,
        preferredRoles: schema.eventSignups.preferredRoles,
        status: schema.eventSignups.status,
        signedUpAt: schema.eventSignups.signedUpAt,
      })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));

    // Get all current roster assignments
    const currentAssignments = await tx
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    // Count filled slots per role
    const filledPerRole: Record<string, number> = {
      tank: 0,
      healer: 0,
      dps: 0,
    };
    for (const a of currentAssignments) {
      if (a.role && a.role in filledPerRole) {
        filledPerRole[a.role]++;
      }
    }

    // Get new signup's preferred roles
    const newSignup = allSignups.find((s) => s.id === newSignupId);
    if (!newSignup?.preferredRoles || newSignup.preferredRoles.length === 0) {
      return;
    }
    // ROK-539: Sort preferred roles so tank/healer are tried before DPS
    const rolePriority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
    const newPrefs = [...(newSignup.preferredRoles ?? [])].sort(
      (a, b) => (rolePriority[a] ?? 99) - (rolePriority[b] ?? 99),
    );

    // Build occupied positions per role for gap-finding
    const occupiedPositions: Record<string, Set<number>> = {
      tank: new Set(),
      healer: new Set(),
      dps: new Set(),
    };
    for (const a of currentAssignments) {
      if (a.role && a.role in occupiedPositions) {
        occupiedPositions[a.role].add(a.position);
      }
    }

    // Find first available position (fills gaps left by leaves/rearranges)
    const findFirstAvailablePosition = (role: string): number => {
      const occupied = occupiedPositions[role] ?? new Set();
      for (let pos = 1; ; pos++) {
        if (!occupied.has(pos)) return pos;
      }
    };

    // Try direct assignment: find an open slot matching one of the new player's prefs
    for (const role of newPrefs) {
      if (role in roleCapacity && filledPerRole[role] < roleCapacity[role]) {
        // Open slot found — assign to first available position (fills gaps)
        const position = findFirstAvailablePosition(role);
        await tx.insert(schema.rosterAssignments).values({
          eventId,
          signupId: newSignupId,
          role,
          position,
          isOverride: 0,
        });
        // ROK-598: Auto-slotted signups are implicitly confirmed
        await tx
          .update(schema.eventSignups)
          .set({ confirmationStatus: 'confirmed' })
          .where(eq(schema.eventSignups.id, newSignupId));
        this.logger.log(
          `Auto-allocated signup ${newSignupId} to ${role} slot ${position} (direct match)`,
        );
        await this.benchPromotionService.cancelPromotion(
          eventId,
          role,
          position,
        );
        return;
      }
    }

    // No direct slot available — try chain rearrangement via BFS.
    // Finds the shortest sequence of moves that frees a slot for the new player.
    // Example: new player wants DPS (full). Player A in DPS can play Healer (full).
    //          Player B in Healer can play Tank (open). Chain: B→Tank, A→Healer, new→DPS.
    const chain = this.findRearrangementChain(
      newPrefs,
      currentAssignments,
      allSignups,
      roleCapacity,
      filledPerRole,
    );

    if (chain) {
      // Execute moves in reverse order (innermost move first to free slots outward).
      // Each player takes the position vacated by the next player in the chain.
      // The last mover (innermost) gets a fresh position in their target role.
      for (let i = chain.moves.length - 1; i >= 0; i--) {
        const move = chain.moves[i];
        // If there's a subsequent move in the chain that freed a position in this role, take it
        const nextMove = i < chain.moves.length - 1 ? chain.moves[i + 1] : null;
        const newPos =
          nextMove && nextMove.fromRole === move.toRole
            ? nextMove.position
            : findFirstAvailablePosition(move.toRole);
        await tx
          .update(schema.rosterAssignments)
          .set({ role: move.toRole, position: newPos })
          .where(eq(schema.rosterAssignments.id, move.assignmentId));
        // Track position changes for both occupancy and capacity
        occupiedPositions[move.fromRole]?.delete(move.position);
        occupiedPositions[move.toRole]?.add(newPos);
        if (!nextMove || nextMove.fromRole !== move.toRole) {
          filledPerRole[move.toRole]++;
        }
        this.logger.log(
          `Chain rearrange: signup ${move.signupId} moved from ${move.fromRole} to ${move.toRole} slot ${newPos}`,
        );
      }

      // Assign new player to the freed slot (position vacated by the first mover)
      const freedRole = chain.freedRole;
      const freedPosition = chain.moves[0].position;
      await tx.insert(schema.rosterAssignments).values({
        eventId,
        signupId: newSignupId,
        role: freedRole,
        position: freedPosition,
        isOverride: 0,
      });

      // ROK-598: Auto-slotted signups are implicitly confirmed
      await tx
        .update(schema.eventSignups)
        .set({ confirmationStatus: 'confirmed' })
        .where(eq(schema.eventSignups.id, newSignupId));
      this.logger.log(
        `Auto-allocated signup ${newSignupId} to ${freedRole} slot ${freedPosition} (${chain.moves.length}-step chain rearrangement)`,
      );
      await this.benchPromotionService.cancelPromotion(
        eventId,
        freedRole,
        freedPosition,
      );
      return;
    }

    // ROK-459: No rearrangement possible among confirmed players — try tentative displacement.
    // If a tentative player occupies a slot in one of the new player's preferred roles,
    // displace the longest-tentative to unassigned pool and give their slot to the new player.
    const newSignupStatus = allSignups.find(
      (s) => s.id === newSignupId,
    )?.status;
    if (newSignupStatus !== 'tentative') {
      const displaced = await this.displaceTentativeForSlot(
        tx,
        eventId,
        newSignupId,
        newPrefs,
        currentAssignments,
        allSignups,
        roleCapacity,
        occupiedPositions,
        findFirstAvailablePosition,
      );
      if (displaced) return;
    }

    // No rearrangement or displacement possible — leave in unassigned pool
    this.logger.log(
      `Auto-allocation: signup ${newSignupId} could not be placed (all preferred slots full, no rearrangement or tentative displacement available)`,
    );
  }

  /**
   * ROK-459: When a slot vacates, check for tentative unassigned players
   * who prefer that role and assign them to the open slot.
   */
  private async reslotTentativePlayer(
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<void> {
    // ROK-459 review fix: wrap in transaction to prevent race between check and insert
    const reslottedSignupId = await this.db.transaction(async (tx) => {
      // Find tentative unassigned players who prefer this role
      const candidates = await tx
        .select({
          id: schema.eventSignups.id,
          preferredRoles: schema.eventSignups.preferredRoles,
          signedUpAt: schema.eventSignups.signedUpAt,
        })
        .from(schema.eventSignups)
        .leftJoin(
          schema.rosterAssignments,
          eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
        )
        .where(
          and(
            eq(schema.eventSignups.eventId, eventId),
            eq(schema.eventSignups.status, 'tentative'),
            isNull(schema.rosterAssignments.id),
          ),
        )
        .orderBy(schema.eventSignups.signedUpAt);

      // Find first candidate who prefers the vacated role
      const candidate = candidates.find((c) => {
        const prefs = c.preferredRoles ?? [];
        return prefs.includes(vacatedRole);
      });

      if (!candidate) return null;

      // Verify the slot is still empty (might have been filled by bench promotion)
      const [existing] = await tx
        .select({ id: schema.rosterAssignments.id })
        .from(schema.rosterAssignments)
        .where(
          and(
            eq(schema.rosterAssignments.eventId, eventId),
            eq(schema.rosterAssignments.role, vacatedRole),
            eq(schema.rosterAssignments.position, vacatedPosition),
          ),
        )
        .limit(1);

      if (existing) return null; // Slot already filled

      // Assign the tentative player to the vacated slot
      await tx.insert(schema.rosterAssignments).values({
        eventId,
        signupId: candidate.id,
        role: vacatedRole,
        position: vacatedPosition,
        isOverride: 0,
      });

      return candidate.id;
    });

    if (!reslottedSignupId) return;

    this.logger.log(
      `ROK-459: Reslotted tentative signup ${reslottedSignupId} to ${vacatedRole} slot ${vacatedPosition}`,
    );

    // Resync embed
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: reslottedSignupId,
      action: 'tentative_reslotted',
    });
  }

  /**
   * ROK-459: Check if a newly-tentative slotted player should be displaced by
   * a confirmed unassigned player waiting for the same role.
   * Called as a fire-and-forget side effect from updateStatus().
   */
  private async checkTentativeDisplacement(
    eventId: number,
    tentativeSignupId: number,
  ): Promise<void> {
    // Get the tentative player's current roster assignment
    const [assignment] = await this.db
      .select()
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, tentativeSignupId),
        ),
      )
      .limit(1);

    if (!assignment || !assignment.role) return; // Not slotted, nothing to displace

    const role = assignment.role;

    // Find confirmed unassigned players who want this role
    const unassignedConfirmed = await this.db
      .select({
        id: schema.eventSignups.id,
        preferredRoles: schema.eventSignups.preferredRoles,
        signedUpAt: schema.eventSignups.signedUpAt,
      })
      .from(schema.eventSignups)
      .leftJoin(
        schema.rosterAssignments,
        eq(schema.eventSignups.id, schema.rosterAssignments.signupId),
      )
      .where(
        and(
          eq(schema.eventSignups.eventId, eventId),
          eq(schema.eventSignups.status, 'signed_up'),
          isNull(schema.rosterAssignments.id),
        ),
      );

    // Find one that wants this role
    const candidate = unassignedConfirmed.find((s) => {
      const prefs = s.preferredRoles ?? [];
      return prefs.includes(role);
    });

    if (!candidate) return; // No confirmed player waiting for this role

    // Get event's slot config for the displacement method
    const [event] = await this.db
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    const slotConfig = event?.slotConfig as Record<string, unknown> | null;
    if (slotConfig?.type !== 'mmo') return; // Only MMO events have role-based displacement

    // Run the auto-allocation for the confirmed unassigned player —
    // this will trigger the displacement logic since all slots are full
    await this.db.transaction(async (tx) => {
      await this.autoAllocateSignup(tx, eventId, candidate.id, slotConfig);
    });

    this.logger.log(
      `ROK-459: Triggered displacement check after signup ${tentativeSignupId} went tentative — candidate ${candidate.id}`,
    );

    // Emit update to resync embed
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: tentativeSignupId,
      action: 'tentative_displacement_check',
    });
  }

  /**
   * ROK-459: Displace the longest-tentative player from a preferred role slot.
   * Before benching, attempts to rearrange the tentative player to another
   * preferred role (ROK-452 integration). Returns true if displacement succeeded.
   */
  private async displaceTentativeForSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    newPrefs: string[],
    currentAssignments: Array<{
      id: number;
      signupId: number;
      role: string | null;
      position: number;
    }>,
    allSignups: Array<{
      id: number;
      preferredRoles: string[] | null;
      status: string;
      signedUpAt: Date | null;
    }>,
    roleCapacity: Record<string, number>,
    occupiedPositions: Record<string, Set<number>>,
    findFirstAvailablePosition: (role: string) => number,
  ): Promise<boolean> {
    // Build a map of signupId -> signup data for status lookups
    const signupById = new Map(allSignups.map((s) => [s.id, s]));

    // For each preferred role, find tentative occupants (sorted by signedUpAt ASC = longest tentative first)
    for (const role of newPrefs) {
      if (!(role in roleCapacity)) continue;

      const tentativeOccupants = currentAssignments
        .filter((a) => {
          if (a.role !== role) return false;
          const signup = signupById.get(a.signupId);
          return signup?.status === 'tentative';
        })
        .sort((a, b) => {
          const aTime = signupById.get(a.signupId)?.signedUpAt?.getTime() ?? 0;
          const bTime = signupById.get(b.signupId)?.signedUpAt?.getTime() ?? 0;
          return aTime - bTime; // Oldest tentative first (FIFO)
        });

      if (tentativeOccupants.length === 0) continue;

      const victim = tentativeOccupants[0];
      const victimSignup = signupById.get(victim.signupId);
      const victimPrefs =
        (victimSignup?.preferredRoles as string[] | null) ?? [];

      // Try to rearrange the tentative player to another preferred role (not the displaced role)
      const alternativeRoles = victimPrefs.filter(
        (r) => r !== role && r in roleCapacity,
      );
      let rearrangedToRole: string | undefined;

      for (const altRole of alternativeRoles) {
        const filledInAlt = currentAssignments.filter(
          (a) => a.role === altRole,
        ).length;
        if (filledInAlt < roleCapacity[altRole]) {
          // Open slot in alternative role — move tentative player there
          const newPos = findFirstAvailablePosition(altRole);
          await tx
            .update(schema.rosterAssignments)
            .set({ role: altRole, position: newPos })
            .where(eq(schema.rosterAssignments.id, victim.id));
          occupiedPositions[role]?.delete(victim.position);
          occupiedPositions[altRole]?.add(newPos);
          this.logger.log(
            `ROK-459: Rearranged tentative signup ${victim.signupId} from ${role} slot ${victim.position} to ${altRole} slot ${newPos}`,
          );
          rearrangedToRole = altRole;
          break;
        }
      }

      if (!rearrangedToRole) {
        // No alternative — remove assignment (move to unassigned pool)
        await tx
          .delete(schema.rosterAssignments)
          .where(eq(schema.rosterAssignments.id, victim.id));
        occupiedPositions[role]?.delete(victim.position);
        this.logger.log(
          `ROK-459: Displaced tentative signup ${victim.signupId} from ${role} slot ${victim.position} to unassigned pool`,
        );
      }

      // Assign new confirmed player to the freed slot
      const freedPosition = rearrangedToRole
        ? findFirstAvailablePosition(role)
        : victim.position;
      await tx.insert(schema.rosterAssignments).values({
        eventId,
        signupId: newSignupId,
        role,
        position: freedPosition,
        isOverride: 0,
      });
      occupiedPositions[role]?.add(freedPosition);

      // ROK-598: Auto-slotted signups are implicitly confirmed
      await tx
        .update(schema.eventSignups)
        .set({ confirmationStatus: 'confirmed' })
        .where(eq(schema.eventSignups.id, newSignupId));
      this.logger.log(
        `ROK-459: Auto-allocated confirmed signup ${newSignupId} to ${role} slot ${freedPosition} (tentative displacement)`,
      );
      await this.benchPromotionService.cancelPromotion(
        eventId,
        role,
        freedPosition,
      );

      // Send notification to displaced player
      if (victimSignup) {
        const [event] = await tx
          .select({ title: schema.events.title })
          .from(schema.events)
          .where(eq(schema.events.id, eventId))
          .limit(1);
        const eventTitle = event?.title ?? `Event #${eventId}`;
        const action = rearrangedToRole
          ? `moved to ${rearrangedToRole}`
          : 'moved to the unassigned pool';

        // Only notify registered users (not anonymous Discord signups)
        const [signup] = await tx
          .select({ userId: schema.eventSignups.userId })
          .from(schema.eventSignups)
          .where(eq(schema.eventSignups.id, victim.signupId))
          .limit(1);

        if (signup?.userId) {
          // ROK-538: Look up Discord embed URL for the event
          const discordUrl =
            await this.notificationService.getDiscordEmbedUrl(eventId);
          // ROK-507: Resolve voice channel for the event
          const voiceChannelId =
            await this.notificationService.resolveVoiceChannelForEvent(eventId);
          this.notificationService
            .create({
              userId: signup.userId,
              type: 'tentative_displaced',
              title: 'Roster update',
              message: `A confirmed player took your ${role} slot in "${eventTitle}". You've been ${action}.`,
              payload: {
                eventId,
                ...(discordUrl ? { discordUrl } : {}),
                ...(voiceChannelId ? { voiceChannelId } : {}),
              },
            })
            .catch((err: unknown) => {
              this.logger.warn(
                `Failed to notify displaced tentative player: ${err instanceof Error ? err.message : 'Unknown error'}`,
              );
            });
        }
      }

      return true;
    }

    return false;
  }

  /**
   * BFS chain rearrangement solver for auto-allocation.
   * Finds the shortest chain of moves that frees a slot for the new player.
   *
   * BFS frontier: each node is (role to free, set of already-visited assignments).
   * At each step, find a flexible occupant in that role who can move to another role.
   * If that other role is open → chain complete. If full → enqueue that role.
   * Max depth: 3 (prevents combinatorial explosion for large rosters).
   */
  private findRearrangementChain(
    newPrefs: string[],
    currentAssignments: Array<{
      id: number;
      signupId: number;
      role: string | null;
      position: number;
    }>,
    allSignups: Array<{ id: number; preferredRoles: string[] | null }>,
    roleCapacity: Record<string, number>,
    filledPerRole: Record<string, number>,
  ): {
    freedRole: string;
    moves: Array<{
      assignmentId: number;
      signupId: number;
      fromRole: string;
      toRole: string;
      position: number;
    }>;
  } | null {
    const MAX_DEPTH = 3;

    interface QueueEntry {
      roleToFree: string;
      moves: Array<{
        assignmentId: number;
        signupId: number;
        fromRole: string;
        toRole: string;
        position: number;
      }>;
      usedSignupIds: Set<number>;
    }

    const queue: QueueEntry[] = [];

    // Seed the BFS with the new player's preferred roles
    for (const pref of newPrefs) {
      if (pref in roleCapacity) {
        queue.push({ roleToFree: pref, moves: [], usedSignupIds: new Set() });
      }
    }

    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (entry.moves.length >= MAX_DEPTH) continue;

      // Find flexible occupants in the role we need to free
      const occupants = currentAssignments.filter(
        (a) =>
          a.role === entry.roleToFree && !entry.usedSignupIds.has(a.signupId),
      );

      for (const occupant of occupants) {
        const occupantSignup = allSignups.find(
          (s) => s.id === occupant.signupId,
        );
        const occupantPrefs =
          (occupantSignup?.preferredRoles as string[] | null) ?? [];
        if (occupantPrefs.length <= 1) continue;

        for (const altRole of occupantPrefs) {
          if (altRole === entry.roleToFree || !(altRole in roleCapacity))
            continue;

          const move = {
            assignmentId: occupant.id,
            signupId: occupant.signupId,
            fromRole: entry.roleToFree,
            toRole: altRole,
            position: occupant.position,
          };
          const newMoves = [...entry.moves, move];

          // Count how many moves are already targeting this altRole
          const movesIntoAltRole = newMoves.filter(
            (m) => m.toRole === altRole,
          ).length;
          const effectiveFilled = filledPerRole[altRole] + movesIntoAltRole;
          // Also subtract any moves OUT of altRole in the chain
          const movesOutOfAltRole = newMoves.filter(
            (m) => m.fromRole === altRole,
          ).length;
          const netFilled = effectiveFilled - movesOutOfAltRole;

          if (netFilled <= roleCapacity[altRole]) {
            // This role has space — chain complete
            return {
              freedRole:
                entry.moves.length === 0
                  ? entry.roleToFree
                  : entry.moves[0].fromRole,
              moves: newMoves,
            };
          }

          // altRole is also full — continue BFS
          const newUsed = new Set(entry.usedSignupIds);
          newUsed.add(occupant.signupId);
          queue.push({
            roleToFree: altRole,
            moves: newMoves,
            usedSignupIds: newUsed,
          });
        }
      }
    }

    return null;
  }

  /**
   * ROK-451: For generic (non-MMO) events with an explicit slot configuration,
   * resolve the auto-slot role to 'player' if there are open slots.
   * Returns null for MMO events, events without a slot config, or when all slots are full.
   *
   * Only auto-slots when the event has:
   * - An explicit `slotConfig` with `type !== 'mmo'` (generic), OR
   * - A `maxAttendees` cap (which implies generic player slots)
   *
   * Events with no slotConfig and no maxAttendees are left alone — the organizer
   * manages slots manually via the roster builder.
   *
   * @param tx - Transaction handle (or db)
   * @param event - The event row (needs slotConfig, maxAttendees)
   * @param eventId - Event ID for querying current assignments
   * @returns 'player' if a generic slot is open, null otherwise
   */
  private async resolveGenericSlotRole(
    tx: PostgresJsDatabase<typeof schema>,
    event: { slotConfig: unknown; maxAttendees: number | null },
    eventId: number,
  ): Promise<string | null> {
    const slotConfig = event.slotConfig as Record<string, unknown> | null;

    // MMO events require explicit role selection — never auto-slot
    if (slotConfig?.type === 'mmo') return null;

    // Determine max player slots from slotConfig or maxAttendees
    let maxPlayers: number | null = null;
    if (slotConfig) {
      maxPlayers = (slotConfig.player as number) ?? null;
    } else if (event.maxAttendees) {
      maxPlayers = event.maxAttendees;
    }

    // No explicit slot config and no maxAttendees — organizer manages manually
    if (maxPlayers === null) return null;

    // Count current 'player' role assignments
    const currentAssignments = await tx
      .select({ position: schema.rosterAssignments.position })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, 'player'),
        ),
      );

    if (currentAssignments.length >= maxPlayers) return null;

    return 'player';
  }

  /**
   * Emit a signup lifecycle event for Discord embed sync (ROK-119).
   * Fires asynchronously — failures are logged but do not block the caller.
   */
  private emitSignupEvent(
    eventName: string,
    payload: SignupEventPayload,
  ): void {
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
    const identity = buildRosterIdentity(row);
    return {
      id: assignment?.id ?? 0,
      signupId: row.event_signups.id,
      ...identity,
      slot: (assignment?.role as RosterRole) ?? null,
      position: assignment?.position ?? 0,
      isOverride: assignment?.isOverride === 1,
      character: buildRosterCharacter(row.characters),
      preferredRoles:
        (row.event_signups.preferredRoles as
          | ('tank' | 'healer' | 'dps')[]
          | null) ?? null,
      signupStatus: row.event_signups.status as
        | 'signed_up'
        | 'tentative'
        | 'declined',
    };
  }
}

// ============================================================
// Standalone helpers (extracted for max-lines-per-function)
// ============================================================

type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect | null;
type CharacterRow = typeof schema.characters.$inferSelect | null;

function buildRosterIdentity(row: {
  event_signups: SignupRow;
  users: UserRow;
}) {
  const isAnonymous = !row.event_signups.userId;
  return {
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
  };
}

function buildRosterCharacter(characters: CharacterRow) {
  if (!characters) return null;
  return {
    id: characters.id,
    name: characters.name,
    className: characters.class,
    role: characters.roleOverride ?? characters.role,
    avatarUrl: characters.avatarUrl,
  };
}

/** Determine cancel status from time until event start. */
function determineCancelStatus(eventDuration: [Date, Date] | null): {
  cancelStatus: 'declined' | 'roached_out';
  isGracefulDecline: boolean;
  now: Date;
} {
  const now = new Date();
  const eventStartTime = eventDuration?.[0];
  const hoursUntilEvent = eventStartTime
    ? (eventStartTime.getTime() - now.getTime()) / (1000 * 60 * 60)
    : 0;
  const isGracefulDecline = hoursUntilEvent >= 23;
  const cancelStatus = isGracefulDecline ? 'declined' : 'roached_out';
  return { cancelStatus, isGracefulDecline, now };
}

function formatRoleLabel(r: string): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}
