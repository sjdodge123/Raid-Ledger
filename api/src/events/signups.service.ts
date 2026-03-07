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
    const eventRow = await this.fetchEventOrThrow(eventId);
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

    this.emitSignupCreated(eventId, userId, result.signup.id);
    this.rosterNotificationBuffer.bufferJoin(eventId, userId);

    const character = dto?.characterId
      ? await this.getCharacterById(dto.characterId)
      : null;
    return this.buildSignupResponse(result.signup, user, character);
  }

  private async fetchEventOrThrow(eventId: number) {
    const [eventRow] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    if (!eventRow)
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    return eventRow;
  }

  private emitSignupCreated(eventId: number, userId: number, signupId: number) {
    this.emitSignupEvent(SIGNUP_EVENTS.CREATED, {
      eventId,
      userId,
      signupId,
      action: 'signup_created',
    });
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
    const existing = await this.fetchExistingSignup(tx, eventId, userId);

    await this.reactivateIfCancelled(tx, existing, dto, hasCharacter);
    await this.updatePreferredRolesIfNeeded(tx, existing, dto);
    await this.ensureAssignment(
      tx,
      eventRow,
      eventId,
      existing,
      dto,
      autoBench,
    );

    const character = existing.characterId
      ? await this.getCharacterById(existing.characterId)
      : null;
    return {
      isDuplicate: true as const,
      response: this.buildSignupResponse(existing, user, character),
    };
  }

  private async fetchExistingSignup(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    userId: number,
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
    return existing;
  }

  private async ensureAssignment(
    tx: PostgresJsDatabase<typeof schema>,
    eventRow: typeof schema.events.$inferSelect,
    eventId: number,
    existing: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    autoBench: boolean,
  ) {
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
  }

  private async reactivateIfCancelled(
    tx: PostgresJsDatabase<typeof schema>,
    existing: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    hasCharacter: boolean,
  ) {
    if (!this.isCancelledStatus(existing.status)) return;

    const fields = this.buildReactivationFields(existing, dto, hasCharacter);
    await tx
      .update(schema.eventSignups)
      .set(fields)
      .where(eq(schema.eventSignups.id, existing.id));
    Object.assign(existing, fields);
  }

  private isCancelledStatus(status: string) {
    return (
      status === 'roached_out' || status === 'declined' || status === 'departed'
    );
  }

  private buildReactivationFields(
    existing: typeof schema.eventSignups.$inferSelect,
    dto: CreateSignupDto | undefined,
    hasCharacter: boolean,
  ) {
    return {
      status: 'signed_up' as const,
      confirmationStatus: hasCharacter
        ? ('confirmed' as const)
        : ('pending' as const),
      note: dto?.note ?? existing.note,
      characterId: dto?.characterId ?? null,
      preferredRoles: dto?.preferredRoles ?? null,
      attendanceStatus: null,
      attendanceRecordedAt: null,
      roachedOutAt: null,
    };
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
    if (this.shouldUseAutoAllocation(eventRow, existing, dto, autoBench)) {
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

    await this.confirmAndCancelPromotion(
      tx,
      eventId,
      signupId,
      slotRole,
      position,
    );
    this.logger.log(
      `${logPrefix} to ${slotRole} slot ${position}${autoBench ? ' (auto-benched)' : ''}`,
    );
    return slotRole !== 'bench';
  }

  private async confirmAndCancelPromotion(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    slotRole: string,
    position: number,
  ) {
    if (slotRole === 'bench') return;
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

    if (this.shouldUseAutoAllocationNew(eventRow, dto, autoBench)) {
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
    const event = await this.fetchEventOrThrow(eventId);
    const linkedUser = await this.findLinkedUser(dto.discordUserId);
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

  private async findLinkedUser(discordUserId: string) {
    const [user] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.discordId, discordUserId))
      .limit(1);
    return user ?? null;
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
      await this.allocateMmoDiscordSlot(
        tx,
        eventId,
        signupId,
        slotConfig,
        dto,
        hasSingleRole,
      );
      return;
    }

    await this.allocateGenericDiscordSlot(
      tx,
      event,
      eventId,
      signupId,
      dto,
      isMMO,
      hasPrefs,
      hasSingleRole,
    );
  }

  private async allocateMmoDiscordSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    slotConfig: Record<string, unknown> | null,
    dto: CreateDiscordSignupDto,
    hasSingleRole: string | undefined | false,
  ) {
    if (hasSingleRole && dto.role) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [dto.role] })
        .where(eq(schema.eventSignups.id, signupId));
    }
    await this.autoAllocateSignup(tx, eventId, signupId, slotConfig);
  }

  private async allocateGenericDiscordSlot(
    tx: PostgresJsDatabase<typeof schema>,
    event: typeof schema.events.$inferSelect,
    eventId: number,
    signupId: number,
    dto: CreateDiscordSignupDto,
    isMMO: boolean,
    hasPrefs: boolean | undefined,
    hasSingleRole: string | undefined | false,
  ) {
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

    this.fireTentativeDisplacementCheck(eventId, signup.id, dto.status);
    return this.buildStatusUpdateResponse(updated);
  }

  private fireTentativeDisplacementCheck(
    eventId: number,
    signupId: number,
    status: string,
  ) {
    if (status !== 'tentative') return;
    this.checkTentativeDisplacement(eventId, signupId).catch((err: unknown) => {
      this.logger.warn(
        `ROK-459: Failed tentative displacement check: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    });
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
    const linkedUser = await this.findLinkedUser(discordUserId);
    if (linkedUser) return this.cancel(eventId, linkedUser.id);

    const signup = await this.findActiveAnonymousSignup(eventId, discordUserId);
    const cancelInfo = await this.resolveCancelStatus(eventId);

    await this.db
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.signupId, signup.id));
    await this.db
      .update(schema.eventSignups)
      .set({
        status: cancelInfo.cancelStatus,
        roachedOutAt: cancelInfo.isGracefulDecline ? null : cancelInfo.now,
      })
      .where(eq(schema.eventSignups.id, signup.id));

    this.logger.log(
      `Anonymous Discord user ${discordUserId} canceled signup for event ${eventId} (${cancelInfo.cancelStatus})`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.DELETED, {
      eventId,
      signupId: signup.id,
      action: 'discord_signup_cancelled',
    });
  }

  private async resolveCancelStatus(eventId: number) {
    const [event] = await this.db
      .select({ duration: schema.events.duration })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return determineCancelStatus(event?.duration as [Date, Date] | null);
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
    const cancelInfo = await this.resolveCancelStatus(eventId);

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
      cancelInfo.cancelStatus,
      cancelInfo.isGracefulDecline,
      cancelInfo.now,
    );

    this.logger.log(
      `User ${userId} canceled signup for event ${eventId} (${cancelInfo.cancelStatus})`,
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

    await this.triggerSlotBackfill(eventId, assignment);
  }

  private async triggerSlotBackfill(
    eventId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect,
  ) {
    if (!assignment.role || assignment.role === 'bench') return;

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
    return this.buildSignupResponse(
      row.event_signups,
      row.users ?? undefined,
      row.characters,
    );
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

    await this.scheduleBenchPromotionIfEligible(eventId, assignment);
    return this.getRosterWithAssignments(eventId);
  }

  private async scheduleBenchPromotionIfEligible(
    eventId: number,
    assignment: typeof schema.rosterAssignments.$inferSelect,
  ) {
    if (!assignment.role || assignment.role === 'bench') return;
    if (!(await this.benchPromotionService.isEligible(eventId))) return;
    await this.benchPromotionService.schedulePromotion(
      eventId,
      assignment.role,
      assignment.position,
    );
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

    if (signup.userId)
      await this.notifyRemovedUser(signup.userId, eventId, event.title);
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
  ): Promise<PromotionResult | null> {
    return this.db.transaction((tx) =>
      this.promoteFromBenchTx(tx, eventId, signupId),
    );
  }

  private async promoteFromBenchTx(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
  ): Promise<PromotionResult | null> {
    const slotConfig = await this.fetchSlotConfig(tx, eventId);
    if (!slotConfig) return null;

    const signup = await this.fetchPromotionSignup(tx, signupId);
    if (!signup) return null;

    const username = await this.resolveSignupUsername(tx, signup.userId);

    if (slotConfig.type !== 'mmo') {
      return this.promoteGenericSlot(
        tx,
        eventId,
        signupId,
        slotConfig,
        username,
      );
    }

    return this.promoteMmoSlot(
      tx,
      eventId,
      signupId,
      slotConfig,
      signup,
      username,
    );
  }

  private async fetchSlotConfig(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
  ) {
    const [event] = await tx
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    return (event?.slotConfig as Record<string, unknown>) ?? null;
  }

  private async fetchPromotionSignup(
    tx: PostgresJsDatabase<typeof schema>,
    signupId: number,
  ) {
    const [signup] = await tx
      .select({
        preferredRoles: schema.eventSignups.preferredRoles,
        userId: schema.eventSignups.userId,
      })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, signupId))
      .limit(1);
    return signup ?? null;
  }

  private async resolveSignupUsername(
    tx: PostgresJsDatabase<typeof schema>,
    userId: number | null,
  ) {
    if (!userId) return 'Bench player';
    const [user] = await tx
      .select({ username: schema.users.username })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return user?.username ?? 'Bench player';
  }

  private async promoteMmoSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    slotConfig: Record<string, unknown>,
    signup: { preferredRoles: string[] | null; userId: number | null },
    username: string,
  ): Promise<PromotionResult | null> {
    const beforeAssignments = await this.snapshotNonBenchAssignments(
      tx,
      eventId,
    );
    await this.deleteBenchAssignment(tx, eventId, signupId);
    await this.autoAllocateSignup(tx, eventId, signupId, slotConfig);

    const newAssignment = await this.fetchCurrentAssignment(
      tx,
      eventId,
      signupId,
    );
    if (!newAssignment || newAssignment.role === 'bench') {
      return this.handleFailedPromotion(
        tx,
        eventId,
        signupId,
        newAssignment,
        username,
      );
    }

    return this.buildMmoPromotionResult(
      tx,
      eventId,
      signupId,
      beforeAssignments,
      newAssignment,
      signup,
      username,
    );
  }

  private async snapshotNonBenchAssignments(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
  ) {
    return tx
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
  }

  private async deleteBenchAssignment(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
  ) {
    await tx
      .delete(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, signupId),
          eq(schema.rosterAssignments.role, 'bench'),
        ),
      );
  }

  private async fetchCurrentAssignment(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
  ) {
    const [a] = await tx
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
    return a ?? null;
  }

  private async handleFailedPromotion(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    existing: { role: string | null } | null,
    username: string,
  ): Promise<PromotionResult> {
    if (!existing) {
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

  private async buildMmoPromotionResult(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    beforeAssignments: RosterSnapshot[],
    newAssignment: { role: string | null; position: number },
    signup: { preferredRoles: string[] | null },
    username: string,
  ): Promise<PromotionResult> {
    const afterAssignments = await this.snapshotNonBenchAssignments(
      tx,
      eventId,
    );
    const chainMoves = await this.detectChainMoves(
      tx,
      beforeAssignments,
      afterAssignments,
      signupId,
    );
    const warnings = buildPromotionWarnings(
      username,
      signup.preferredRoles,
      newAssignment.role,
      chainMoves,
    );

    return {
      role: newAssignment.role ?? 'bench',
      position: newAssignment.position,
      username,
      chainMoves: chainMoves.map(
        (m) => `${m.username}: ${m.fromRole} → ${m.toRole}`,
      ),
      warning: warnings.length > 0 ? warnings.join('\n') : undefined,
    };
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
  ): Promise<PromotionResult | null> {
    const maxPlayers = (slotConfig.player as number) ?? null;
    await this.deleteBenchAssignment(tx, eventId, signupId);

    const currentPlayers = await this.fetchPlayerPositions(tx, eventId);
    if (maxPlayers !== null && currentPlayers.length >= maxPlayers) {
      return this.restoreBenchAfterFailedGeneric(
        tx,
        eventId,
        signupId,
        username,
      );
    }

    const position = findFirstGap(currentPlayers.map((p) => p.position));
    await tx
      .insert(schema.rosterAssignments)
      .values({ eventId, signupId, role: 'player', position, isOverride: 0 });
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, signupId));

    return { role: 'player', position, username };
  }

  private async fetchPlayerPositions(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
  ) {
    return tx
      .select({ position: schema.rosterAssignments.position })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, 'player'),
        ),
      );
  }

  private async restoreBenchAfterFailedGeneric(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    username: string,
  ): Promise<PromotionResult> {
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

  /**
   * ROK-627: Detect chain moves by comparing roster snapshots before and after
   * autoAllocateSignup. Returns details of players who were moved to different roles.
   */
  private async detectChainMoves(
    tx: PostgresJsDatabase<typeof schema>,
    before: RosterSnapshot[],
    after: RosterSnapshot[],
    excludeSignupId: number,
  ): Promise<ChainMove[]> {
    const movedEntries = findRoleChanges(before, after, excludeSignupId);
    if (movedEntries.length === 0) return [];

    const usernameMap = await this.batchFetchUsernames(
      tx,
      movedEntries.map((m) => m.signupId),
    );

    return movedEntries.map((entry) => ({
      signupId: entry.signupId,
      username: usernameMap.get(entry.signupId) ?? 'Unknown',
      fromRole: entry.fromRole,
      toRole: entry.toRole,
    }));
  }

  private async batchFetchUsernames(
    tx: PostgresJsDatabase<typeof schema>,
    signupIds: number[],
  ): Promise<Map<number, string>> {
    const signups = await tx
      .select({
        id: schema.eventSignups.id,
        userId: schema.eventSignups.userId,
        discordUsername: schema.eventSignups.discordUsername,
      })
      .from(schema.eventSignups)
      .where(inArray(schema.eventSignups.id, signupIds));

    const userIds = signups
      .filter((s) => !s.discordUsername && s.userId)
      .map((s) => s.userId!);
    const userMap = await this.fetchUserMap(tx, userIds);

    const result = new Map<number, string>();
    for (const s of signups) {
      const name =
        s.discordUsername ??
        (s.userId ? userMap.get(s.userId) : undefined) ??
        'Unknown';
      result.set(s.id, name);
    }
    return result;
  }

  private async fetchUserMap(
    tx: PostgresJsDatabase<typeof schema>,
    userIds: number[],
  ): Promise<Map<number, string>> {
    if (userIds.length === 0) return new Map();
    const users = await tx
      .select({ id: schema.users.id, username: schema.users.username })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    return new Map(users.map((u) => [u.id, u.username]));
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
    const ctx = await this.buildAllocationContext(tx, eventId, slotConfig);
    const newSignup = ctx.allSignups.find((s) => s.id === newSignupId);
    if (!newSignup?.preferredRoles || newSignup.preferredRoles.length === 0)
      return;

    const newPrefs = sortByRolePriority(newSignup.preferredRoles);

    if (await this.tryDirectAllocation(tx, eventId, newSignupId, newPrefs, ctx))
      return;
    if (
      await this.tryChainRearrangement(tx, eventId, newSignupId, newPrefs, ctx)
    )
      return;
    if (
      await this.tryTentativeDisplacement(
        tx,
        eventId,
        newSignupId,
        newPrefs,
        newSignup.status,
        ctx,
      )
    )
      return;

    this.logger.log(
      `Auto-allocation: signup ${newSignupId} could not be placed (all preferred slots full, no rearrangement or tentative displacement available)`,
    );
  }

  private async buildAllocationContext(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    slotConfig: Record<string, unknown> | null,
  ): Promise<AllocationContext> {
    const roleCapacity = extractRoleCapacity(slotConfig);
    const allSignups = await this.fetchAllSignups(tx, eventId);
    const currentAssignments = await tx
      .select()
      .from(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.eventId, eventId));

    const filledPerRole = countFilledPerRole(currentAssignments);
    const occupiedPositions = buildOccupiedPositions(currentAssignments);

    return {
      roleCapacity,
      allSignups,
      currentAssignments,
      filledPerRole,
      occupiedPositions,
    };
  }

  private async fetchAllSignups(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
  ) {
    return tx
      .select({
        id: schema.eventSignups.id,
        preferredRoles: schema.eventSignups.preferredRoles,
        status: schema.eventSignups.status,
        signedUpAt: schema.eventSignups.signedUpAt,
      })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.eventId, eventId));
  }

  private async tryDirectAllocation(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    newPrefs: string[],
    ctx: AllocationContext,
  ): Promise<boolean> {
    for (const role of newPrefs) {
      if (
        !(role in ctx.roleCapacity) ||
        ctx.filledPerRole[role] >= ctx.roleCapacity[role]
      )
        continue;

      const position = findFirstAvailableInSet(ctx.occupiedPositions[role]);
      await this.insertAndConfirmSlot(tx, eventId, newSignupId, role, position);
      this.logger.log(
        `Auto-allocated signup ${newSignupId} to ${role} slot ${position} (direct match)`,
      );
      await this.benchPromotionService.cancelPromotion(eventId, role, position);
      return true;
    }
    return false;
  }

  private async insertAndConfirmSlot(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    signupId: number,
    role: string,
    position: number,
  ) {
    await tx.insert(schema.rosterAssignments).values({
      eventId,
      signupId,
      role,
      position,
      isOverride: 0,
    });
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, signupId));
  }

  private async tryChainRearrangement(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    newPrefs: string[],
    ctx: AllocationContext,
  ): Promise<boolean> {
    const chain = this.findRearrangementChain(
      newPrefs,
      ctx.currentAssignments,
      ctx.allSignups,
      ctx.roleCapacity,
      ctx.filledPerRole,
    );
    if (!chain) return false;

    await this.executeChainMoves(tx, chain, ctx);

    const { freedRole } = chain;
    const freedPosition = chain.moves[0].position;
    await this.insertAndConfirmSlot(
      tx,
      eventId,
      newSignupId,
      freedRole,
      freedPosition,
    );
    this.logger.log(
      `Auto-allocated signup ${newSignupId} to ${freedRole} slot ${freedPosition} (${chain.moves.length}-step chain rearrangement)`,
    );
    await this.benchPromotionService.cancelPromotion(
      eventId,
      freedRole,
      freedPosition,
    );
    return true;
  }

  private async executeChainMoves(
    tx: PostgresJsDatabase<typeof schema>,
    chain: NonNullable<ReturnType<SignupsService['findRearrangementChain']>>,
    ctx: AllocationContext,
  ) {
    for (let i = chain.moves.length - 1; i >= 0; i--) {
      const move = chain.moves[i];
      const nextMove = i < chain.moves.length - 1 ? chain.moves[i + 1] : null;
      const newPos =
        nextMove && nextMove.fromRole === move.toRole
          ? nextMove.position
          : findFirstAvailableInSet(ctx.occupiedPositions[move.toRole]);

      await tx
        .update(schema.rosterAssignments)
        .set({ role: move.toRole, position: newPos })
        .where(eq(schema.rosterAssignments.id, move.assignmentId));

      ctx.occupiedPositions[move.fromRole]?.delete(move.position);
      ctx.occupiedPositions[move.toRole]?.add(newPos);
      if (!nextMove || nextMove.fromRole !== move.toRole)
        ctx.filledPerRole[move.toRole]++;
      this.logger.log(
        `Chain rearrange: signup ${move.signupId} moved from ${move.fromRole} to ${move.toRole} slot ${newPos}`,
      );
    }
  }

  private async tryTentativeDisplacement(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    newPrefs: string[],
    status: string,
    ctx: AllocationContext,
  ): Promise<boolean> {
    if (status === 'tentative') return false;
    const posFinder = (role: string) =>
      findFirstAvailableInSet(ctx.occupiedPositions[role]);
    return this.displaceTentativeForSlot(
      tx,
      eventId,
      newSignupId,
      newPrefs,
      ctx.currentAssignments,
      ctx.allSignups,
      ctx.roleCapacity,
      ctx.occupiedPositions,
      posFinder,
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
    const reslottedSignupId = await this.db.transaction((tx) =>
      this.reslotTentativeTx(tx, eventId, vacatedRole, vacatedPosition),
    );
    if (!reslottedSignupId) return;

    this.logger.log(
      `ROK-459: Reslotted tentative signup ${reslottedSignupId} to ${vacatedRole} slot ${vacatedPosition}`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: reslottedSignupId,
      action: 'tentative_reslotted',
    });
  }

  private async reslotTentativeTx(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    vacatedRole: string,
    vacatedPosition: number,
  ): Promise<number | null> {
    const candidate = await this.findTentativeCandidate(
      tx,
      eventId,
      vacatedRole,
    );
    if (!candidate) return null;

    if (await this.isSlotOccupied(tx, eventId, vacatedRole, vacatedPosition))
      return null;

    await tx.insert(schema.rosterAssignments).values({
      eventId,
      signupId: candidate.id,
      role: vacatedRole,
      position: vacatedPosition,
      isOverride: 0,
    });
    return candidate.id;
  }

  private async findTentativeCandidate(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    vacatedRole: string,
  ) {
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

    return (
      candidates.find((c) => (c.preferredRoles ?? []).includes(vacatedRole)) ??
      null
    );
  }

  private async isSlotOccupied(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    role: string,
    position: number,
  ): Promise<boolean> {
    const [existing] = await tx
      .select({ id: schema.rosterAssignments.id })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.role, role),
          eq(schema.rosterAssignments.position, position),
        ),
      )
      .limit(1);
    return !!existing;
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
    const role = await this.getTentativeAssignmentRole(
      eventId,
      tentativeSignupId,
    );
    if (!role) return;

    const candidate = await this.findConfirmedCandidateForRole(eventId, role);
    if (!candidate) return;

    const slotConfig = await this.fetchMmoSlotConfig(eventId);
    if (!slotConfig) return;

    await this.db.transaction((tx) =>
      this.autoAllocateSignup(tx, eventId, candidate.id, slotConfig),
    );

    this.logger.log(
      `ROK-459: Triggered displacement check after signup ${tentativeSignupId} went tentative — candidate ${candidate.id}`,
    );
    this.emitSignupEvent(SIGNUP_EVENTS.UPDATED, {
      eventId,
      signupId: tentativeSignupId,
      action: 'tentative_displacement_check',
    });
  }

  private async getTentativeAssignmentRole(
    eventId: number,
    signupId: number,
  ): Promise<string | null> {
    const [assignment] = await this.db
      .select({ role: schema.rosterAssignments.role })
      .from(schema.rosterAssignments)
      .where(
        and(
          eq(schema.rosterAssignments.eventId, eventId),
          eq(schema.rosterAssignments.signupId, signupId),
        ),
      )
      .limit(1);
    return assignment?.role ?? null;
  }

  private async findConfirmedCandidateForRole(eventId: number, role: string) {
    const unassigned = await this.db
      .select({
        id: schema.eventSignups.id,
        preferredRoles: schema.eventSignups.preferredRoles,
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
    return (
      unassigned.find((s) => (s.preferredRoles ?? []).includes(role)) ?? null
    );
  }

  private async fetchMmoSlotConfig(
    eventId: number,
  ): Promise<Record<string, unknown> | null> {
    const [event] = await this.db
      .select({ slotConfig: schema.events.slotConfig })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    const config = event?.slotConfig as Record<string, unknown> | null;
    return config?.type === 'mmo' ? config : null;
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
    currentAssignments: DisplaceAssignment[],
    allSignups: DisplaceSignup[],
    roleCapacity: Record<string, number>,
    occupiedPositions: Record<string, Set<number>>,
    findPos: (role: string) => number,
  ): Promise<boolean> {
    const signupById = new Map(allSignups.map((s) => [s.id, s]));

    for (const role of newPrefs) {
      if (!(role in roleCapacity)) continue;
      const victim = findOldestTentativeOccupant(
        currentAssignments,
        role,
        signupById,
      );
      if (!victim) continue;

      const displaced = await this.executeDisplacement(
        tx,
        eventId,
        newSignupId,
        role,
        victim,
        currentAssignments,
        roleCapacity,
        occupiedPositions,
        findPos,
        signupById,
      );
      if (displaced) return true;
    }
    return false;
  }

  private async executeDisplacement(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    newSignupId: number,
    role: string,
    victim: { id: number; signupId: number; position: number },
    currentAssignments: DisplaceAssignment[],
    roleCapacity: Record<string, number>,
    occupiedPositions: Record<string, Set<number>>,
    findPos: (role: string) => number,
    signupById: Map<number, { preferredRoles: string[] | null }>,
  ): Promise<boolean> {
    const rearrangedToRole = await this.tryRearrangeVictim(
      tx,
      victim,
      role,
      currentAssignments,
      roleCapacity,
      occupiedPositions,
      findPos,
      signupById,
    );

    if (!rearrangedToRole) {
      await this.removeVictimAssignment(tx, victim, role, occupiedPositions);
    }

    const freedPosition = rearrangedToRole ? findPos(role) : victim.position;
    await this.insertAndConfirmSlot(
      tx,
      eventId,
      newSignupId,
      role,
      freedPosition,
    );
    occupiedPositions[role]?.add(freedPosition);
    this.logger.log(
      `ROK-459: Auto-allocated confirmed signup ${newSignupId} to ${role} slot ${freedPosition} (tentative displacement)`,
    );
    await this.benchPromotionService.cancelPromotion(
      eventId,
      role,
      freedPosition,
    );
    this.fireDisplacedNotification(
      tx,
      eventId,
      victim.signupId,
      role,
      rearrangedToRole,
    );
    return true;
  }

  private async tryRearrangeVictim(
    tx: PostgresJsDatabase<typeof schema>,
    victim: { id: number; signupId: number; position: number },
    displacedRole: string,
    currentAssignments: Array<{ role: string | null }>,
    roleCapacity: Record<string, number>,
    occupiedPositions: Record<string, Set<number>>,
    findPos: (role: string) => number,
    signupById: Map<number, { preferredRoles: string[] | null }>,
  ): Promise<string | undefined> {
    const victimPrefs = signupById.get(victim.signupId)?.preferredRoles ?? [];
    const altRoles = victimPrefs.filter(
      (r) => r !== displacedRole && r in roleCapacity,
    );

    for (const altRole of altRoles) {
      const filledInAlt = currentAssignments.filter(
        (a) => a.role === altRole,
      ).length;
      if (filledInAlt >= roleCapacity[altRole]) continue;

      const newPos = findPos(altRole);
      await tx
        .update(schema.rosterAssignments)
        .set({ role: altRole, position: newPos })
        .where(eq(schema.rosterAssignments.id, victim.id));
      occupiedPositions[displacedRole]?.delete(victim.position);
      occupiedPositions[altRole]?.add(newPos);
      this.logger.log(
        `ROK-459: Rearranged tentative signup ${victim.signupId} from ${displacedRole} slot ${victim.position} to ${altRole} slot ${newPos}`,
      );
      return altRole;
    }
    return undefined;
  }

  private async removeVictimAssignment(
    tx: PostgresJsDatabase<typeof schema>,
    victim: { id: number; signupId: number; position: number },
    role: string,
    occupiedPositions: Record<string, Set<number>>,
  ) {
    await tx
      .delete(schema.rosterAssignments)
      .where(eq(schema.rosterAssignments.id, victim.id));
    occupiedPositions[role]?.delete(victim.position);
    this.logger.log(
      `ROK-459: Displaced tentative signup ${victim.signupId} from ${role} slot ${victim.position} to unassigned pool`,
    );
  }

  private fireDisplacedNotification(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    victimSignupId: number,
    role: string,
    rearrangedToRole: string | undefined,
  ) {
    this.sendDisplacedNotification(
      tx,
      eventId,
      victimSignupId,
      role,
      rearrangedToRole,
    ).catch((err: unknown) => {
      this.logger.warn(
        `Failed to notify displaced tentative player: ${err instanceof Error ? err.message : 'Unknown error'}`,
      );
    });
  }

  private async sendDisplacedNotification(
    tx: PostgresJsDatabase<typeof schema>,
    eventId: number,
    victimSignupId: number,
    role: string,
    rearrangedToRole: string | undefined,
  ) {
    const [signup] = await tx
      .select({ userId: schema.eventSignups.userId })
      .from(schema.eventSignups)
      .where(eq(schema.eventSignups.id, victimSignupId))
      .limit(1);
    if (!signup?.userId) return;

    const [event] = await tx
      .select({ title: schema.events.title })
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);
    const eventTitle = event?.title ?? `Event #${eventId}`;
    const action = rearrangedToRole
      ? `moved to ${rearrangedToRole}`
      : 'moved to the unassigned pool';
    const extraPayload = await this.fetchNotificationContext(eventId);

    await this.notificationService.create({
      userId: signup.userId,
      type: 'tentative_displaced',
      title: 'Roster update',
      message: `A confirmed player took your ${role} slot in "${eventTitle}". You've been ${action}.`,
      payload: { eventId, ...extraPayload },
    });
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
  ): RearrangementChainResult | null {
    return bfsRearrangementChain(
      newPrefs,
      currentAssignments,
      allSignups,
      roleCapacity,
      filledPerRole,
    );
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

type DisplaceAssignment = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};
type DisplaceSignup = {
  id: number;
  preferredRoles: string[] | null;
  status: string;
  signedUpAt: Date | null;
};

type BfsEntry = {
  roleToFree: string;
  moves: ChainMoveEntry[];
  usedSignupIds: Set<number>;
};
type BfsAssignment = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};
type BfsSignup = { id: number; preferredRoles: string[] | null };

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

/** Context for auto-allocation algorithm. */
interface AllocationContext {
  roleCapacity: Record<string, number>;
  allSignups: Array<{
    id: number;
    preferredRoles: string[] | null;
    status: string;
    signedUpAt: Date | null;
  }>;
  currentAssignments: Array<typeof schema.rosterAssignments.$inferSelect>;
  filledPerRole: Record<string, number>;
  occupiedPositions: Record<string, Set<number>>;
}

function extractRoleCapacity(
  slotConfig: Record<string, unknown> | null,
): Record<string, number> {
  return {
    tank: (slotConfig?.tank as number) ?? 2,
    healer: (slotConfig?.healer as number) ?? 4,
    dps: (slotConfig?.dps as number) ?? 14,
  };
}

function countFilledPerRole(
  assignments: Array<{ role: string | null }>,
): Record<string, number> {
  const filled: Record<string, number> = { tank: 0, healer: 0, dps: 0 };
  for (const a of assignments) {
    if (a.role && a.role in filled) filled[a.role]++;
  }
  return filled;
}

function buildOccupiedPositions(
  assignments: Array<{ role: string | null; position: number }>,
): Record<string, Set<number>> {
  const occupied: Record<string, Set<number>> = {
    tank: new Set(),
    healer: new Set(),
    dps: new Set(),
  };
  for (const a of assignments) {
    if (a.role && a.role in occupied) occupied[a.role].add(a.position);
  }
  return occupied;
}

function sortByRolePriority(roles: string[]): string[] {
  const priority: Record<string, number> = { tank: 0, healer: 1, dps: 2 };
  return [...roles].sort((a, b) => (priority[a] ?? 99) - (priority[b] ?? 99));
}

function findOldestTentativeOccupant(
  assignments: Array<{
    id: number;
    signupId: number;
    role: string | null;
    position: number;
  }>,
  role: string,
  signupById: Map<number, { status: string; signedUpAt: Date | null }>,
) {
  const tentative = assignments
    .filter(
      (a) =>
        a.role === role && signupById.get(a.signupId)?.status === 'tentative',
    )
    .sort((a, b) => {
      const aTime = signupById.get(a.signupId)?.signedUpAt?.getTime() ?? 0;
      const bTime = signupById.get(b.signupId)?.signedUpAt?.getTime() ?? 0;
      return aTime - bTime;
    });
  return tentative[0] ?? null;
}

function findFirstAvailableInSet(occupied: Set<number> | undefined): number {
  const set = occupied ?? new Set<number>();
  for (let pos = 1; ; pos++) {
    if (!set.has(pos)) return pos;
  }
}

function findRoleChanges(
  before: RosterSnapshot[],
  after: RosterSnapshot[],
  excludeSignupId: number,
): Array<{ signupId: number; fromRole: string; toRole: string }> {
  const beforeMap = new Map(before.map((a) => [a.signupId, a]));
  const changes: Array<{ signupId: number; fromRole: string; toRole: string }> =
    [];
  for (const afterEntry of after) {
    if (afterEntry.signupId === excludeSignupId) continue;
    const beforeEntry = beforeMap.get(afterEntry.signupId);
    if (!beforeEntry || beforeEntry.role === afterEntry.role) continue;
    changes.push({
      signupId: afterEntry.signupId,
      fromRole: beforeEntry.role ?? 'unknown',
      toRole: afterEntry.role ?? 'unknown',
    });
  }
  return changes;
}

function findFirstGap(positions: number[]): number {
  const occupied = new Set(positions);
  let pos = 1;
  while (occupied.has(pos)) pos++;
  return pos;
}

/** Shared result type for bench promotion methods. */
interface PromotionResult {
  role: string;
  position: number;
  username: string;
  chainMoves?: string[];
  warning?: string;
}

/** Snapshot of a roster assignment for chain-move detection. */
type RosterSnapshot = {
  id: number;
  signupId: number;
  role: string | null;
  position: number;
};

/** Chain move detection result. */
interface ChainMove {
  signupId: number;
  username: string;
  fromRole: string;
  toRole: string;
}

function buildPromotionWarnings(
  username: string,
  preferredRoles: string[] | null,
  assignedRole: string | null,
  chainMoves: ChainMove[],
): string[] {
  const warnings: string[] = [];
  const prefs = preferredRoles ?? [];
  if (prefs.length > 0 && assignedRole && !prefs.includes(assignedRole)) {
    warnings.push(
      `${username} was placed in **${assignedRole}** which is not in their preferred roles (${prefs.join(', ')}).`,
    );
  }
  for (const move of chainMoves) {
    warnings.push(
      `${move.username} moved from **${move.fromRole}** to **${move.toRole}** to accommodate the promotion.`,
    );
  }
  return warnings;
}

/** A chain move in the BFS rearrangement solver. */
interface ChainMoveEntry {
  assignmentId: number;
  signupId: number;
  fromRole: string;
  toRole: string;
  position: number;
}

/** Result from the BFS rearrangement chain solver. */
type RearrangementChainResult = {
  freedRole: string;
  moves: ChainMoveEntry[];
};

/**
 * BFS chain rearrangement solver for auto-allocation.
 * Max depth: 3 (prevents combinatorial explosion for large rosters).
 */
function bfsRearrangementChain(
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
): RearrangementChainResult | null {
  const MAX_DEPTH = 3;
  const queue = seedBfsQueue(newPrefs, roleCapacity);

  while (queue.length > 0) {
    const entry = queue.shift()!;
    if (entry.moves.length >= MAX_DEPTH) continue;

    const result = processBfsEntry(
      entry,
      currentAssignments,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    );
    if (result) return result;
  }
  return null;
}

function seedBfsQueue(
  newPrefs: string[],
  roleCapacity: Record<string, number>,
): Array<{
  roleToFree: string;
  moves: ChainMoveEntry[];
  usedSignupIds: Set<number>;
}> {
  return newPrefs
    .filter((pref) => pref in roleCapacity)
    .map((pref) => ({
      roleToFree: pref,
      moves: [],
      usedSignupIds: new Set<number>(),
    }));
}

function processBfsEntry(
  entry: BfsEntry,
  currentAssignments: BfsAssignment[],
  allSignups: BfsSignup[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: BfsEntry[],
): RearrangementChainResult | null {
  const occupants = currentAssignments.filter(
    (a) => a.role === entry.roleToFree && !entry.usedSignupIds.has(a.signupId),
  );

  for (const occupant of occupants) {
    const result = tryOccupantMoves(
      occupant,
      entry,
      allSignups,
      roleCapacity,
      filledPerRole,
      queue,
    );
    if (result) return result;
  }
  return null;
}

function tryOccupantMoves(
  occupant: { id: number; signupId: number; position: number },
  entry: BfsEntry,
  allSignups: BfsSignup[],
  roleCapacity: Record<string, number>,
  filledPerRole: Record<string, number>,
  queue: BfsEntry[],
): RearrangementChainResult | null {
  const prefs =
    allSignups.find((s) => s.id === occupant.signupId)?.preferredRoles ?? [];
  if (prefs.length <= 1) return null;

  for (const altRole of prefs) {
    if (altRole === entry.roleToFree || !(altRole in roleCapacity)) continue;

    const move: ChainMoveEntry = {
      assignmentId: occupant.id,
      signupId: occupant.signupId,
      fromRole: entry.roleToFree,
      toRole: altRole,
      position: occupant.position,
    };
    const newMoves = [...entry.moves, move];
    const netFilled = computeNetFilled(
      newMoves,
      altRole,
      filledPerRole[altRole],
    );

    if (netFilled <= roleCapacity[altRole]) {
      const freedRole =
        entry.moves.length === 0 ? entry.roleToFree : entry.moves[0].fromRole;
      return { freedRole, moves: newMoves };
    }

    const newUsed = new Set(entry.usedSignupIds);
    newUsed.add(occupant.signupId);
    queue.push({
      roleToFree: altRole,
      moves: newMoves,
      usedSignupIds: newUsed,
    });
  }
  return null;
}

function computeNetFilled(
  moves: ChainMoveEntry[],
  altRole: string,
  baseFilled: number,
): number {
  const into = moves.filter((m) => m.toRole === altRole).length;
  const outOf = moves.filter((m) => m.fromRole === altRole).length;
  return baseFilled + into - outOf;
}
