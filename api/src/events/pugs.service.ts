import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, ne } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PUG_SLOT_EVENTS } from '../discord-bot/discord-bot.constants';
import type {
  CreatePugSlotDto,
  UpdatePugSlotDto,
  PugSlotResponseDto,
  PugSlotListResponseDto,
  PugRole,
} from '@raid-ledger/contract';

/** Characters for invite codes — no ambiguous chars (0/O, 1/l/I) */
const INVITE_CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz2345679';
const INVITE_CODE_LENGTH = 8;

/**
 * Payload emitted when a PUG slot is created (ROK-292).
 */
export interface PugSlotCreatedPayload {
  pugSlotId: string;
  eventId: number;
  /** Null for anonymous invite links */
  discordUsername: string | null;
  /** User ID of the admin/user who created the PUG slot */
  creatorUserId: number;
}

/**
 * Service for managing PUG (Pick Up Group) slots on events (ROK-262).
 * PUGs are guest players identified by Discord username, manually added
 * by event creators or officers to fill roster gaps.
 */
@Injectable()
export class PugsService {
  private readonly logger = new Logger(PugsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Add a PUG slot to an event.
   * @param eventId - Event ID
   * @param userId - User creating the PUG slot
   * @param isAdmin - Whether user is admin/operator
   * @param dto - PUG slot data
   * @returns The created PUG slot
   */
  async create(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: CreatePugSlotDto,
  ): Promise<PugSlotResponseDto> {
    // Any authenticated guild member can invite PUGs
    await this.verifyInvitePermission(eventId);

    const inviteCode = await this.generateUniqueInviteCode();
    const discordUsername = dto.discordUsername ?? null;

    try {
      const [inserted] = await this.db
        .insert(schema.pugSlots)
        .values({
          eventId,
          discordUsername,
          role: dto.role,
          class: dto.class ?? null,
          spec: dto.spec ?? null,
          notes: dto.notes ?? null,
          status: 'pending',
          inviteCode,
          createdBy: userId,
        })
        .returning();

      const label = discordUsername ?? `anonymous (${inviteCode})`;
      this.logger.log(
        `PUG slot created: ${label} as ${dto.role} for event ${eventId}`,
      );

      // Emit event for Discord bot integration (ROK-292)
      // Only emit if there's a username to process
      if (discordUsername) {
        this.eventEmitter.emit(PUG_SLOT_EVENTS.CREATED, {
          pugSlotId: inserted.id,
          eventId,
          discordUsername,
          creatorUserId: userId,
        } satisfies PugSlotCreatedPayload);
      }

      return this.toPugSlotResponse(inserted);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('unique_event_pug')
      ) {
        throw new ConflictException(
          `Discord user "${dto.discordUsername}" is already a PUG for this event`,
        );
      }
      throw error;
    }
  }

  /**
   * Regenerate the invite code for a PUG slot (ROK-263).
   */
  async regenerateInviteCode(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
  ): Promise<PugSlotResponseDto> {
    await this.verifyEventPermission(eventId, userId, isAdmin);

    const [existing] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.id, pugId),
          eq(schema.pugSlots.eventId, eventId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(
        `PUG slot ${pugId} not found for event ${eventId}`,
      );
    }

    const newCode = await this.generateUniqueInviteCode();
    const [updated] = await this.db
      .update(schema.pugSlots)
      .set({ inviteCode: newCode, updatedAt: new Date() })
      .where(eq(schema.pugSlots.id, pugId))
      .returning();

    this.logger.log(
      `Regenerated invite code for PUG slot ${pugId}: ${newCode}`,
    );
    return this.toPugSlotResponse(updated);
  }

  /**
   * Find a PUG slot by invite code (ROK-263).
   */
  async findByInviteCode(
    code: string,
  ): Promise<typeof schema.pugSlots.$inferSelect | null> {
    const [slot] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.inviteCode, code))
      .limit(1);
    return slot ?? null;
  }

  /**
   * List all PUG slots for an event.
   * @param eventId - Event ID
   * @returns List of PUG slots
   */
  async findAll(eventId: number): Promise<PugSlotListResponseDto> {
    // Verify event exists
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    // ROK-409: Filter out claimed slots — they represent resolved invites
    const pugs = await this.db
      .select()
      .from(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.eventId, eventId),
          ne(schema.pugSlots.status, 'claimed'),
        ),
      )
      .orderBy(schema.pugSlots.createdAt);

    return {
      pugs: pugs.map((p) => this.toPugSlotResponse(p)),
    };
  }

  /**
   * Update a PUG slot.
   * @param eventId - Event ID
   * @param pugId - PUG slot UUID
   * @param userId - User making the request
   * @param isAdmin - Whether user is admin/operator
   * @param dto - Update data
   * @returns Updated PUG slot
   */
  async update(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
    dto: UpdatePugSlotDto,
  ): Promise<PugSlotResponseDto> {
    await this.verifyEventPermission(eventId, userId, isAdmin);

    // Verify PUG exists for this event
    const [existing] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.id, pugId),
          eq(schema.pugSlots.eventId, eventId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(
        `PUG slot ${pugId} not found for event ${eventId}`,
      );
    }

    // Build update object, only including provided fields
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };
    if (dto.discordUsername !== undefined)
      updateData.discordUsername = dto.discordUsername;
    if (dto.role !== undefined) updateData.role = dto.role;
    if (dto.class !== undefined) updateData.class = dto.class;
    if (dto.spec !== undefined) updateData.spec = dto.spec;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    try {
      const [updated] = await this.db
        .update(schema.pugSlots)
        .set(updateData)
        .where(eq(schema.pugSlots.id, pugId))
        .returning();

      this.logger.log(`PUG slot ${pugId} updated for event ${eventId}`);

      return this.toPugSlotResponse(updated);
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        error.message.includes('unique_event_pug')
      ) {
        throw new ConflictException(
          `Discord user "${dto.discordUsername}" is already a PUG for this event`,
        );
      }
      throw error;
    }
  }

  /**
   * Remove a PUG slot.
   * @param eventId - Event ID
   * @param pugId - PUG slot UUID
   * @param userId - User making the request
   * @param isAdmin - Whether user is admin/operator
   */
  async remove(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    // Verify PUG exists for this event
    const [existing] = await this.db
      .select()
      .from(schema.pugSlots)
      .where(
        and(
          eq(schema.pugSlots.id, pugId),
          eq(schema.pugSlots.eventId, eventId),
        ),
      )
      .limit(1);

    if (!existing) {
      throw new NotFoundException(
        `PUG slot ${pugId} not found for event ${eventId}`,
      );
    }

    // Allow removal by: creator/admin, event creator, or the user who created the invite
    if (existing.createdBy !== userId) {
      await this.verifyEventPermission(eventId, userId, isAdmin);
    }

    await this.db.delete(schema.pugSlots).where(eq(schema.pugSlots.id, pugId));

    this.logger.log(
      `PUG slot ${pugId} (${existing.discordUsername}) removed from event ${eventId}`,
    );
  }

  /**
   * Verify the event exists and the user has permission (creator or admin/operator).
   */
  private async verifyEventPermission(
    eventId: number,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }

    if (event.creatorId !== userId && !isAdmin) {
      throw new ForbiddenException(
        'Only event creator or admin/operator can manage PUG slots',
      );
    }
  }

  /**
   * Verify the user can invite PUGs: any authenticated guild member.
   * The event must exist; the caller must be authenticated (guaranteed by guard).
   */
  private async verifyInvitePermission(eventId: number): Promise<void> {
    const [event] = await this.db
      .select()
      .from(schema.events)
      .where(eq(schema.events.id, eventId))
      .limit(1);

    if (!event) {
      throw new NotFoundException(`Event with ID ${eventId} not found`);
    }
  }

  /**
   * Convert a database row to PugSlotResponseDto.
   */
  private toPugSlotResponse(
    row: typeof schema.pugSlots.$inferSelect,
  ): PugSlotResponseDto {
    return {
      id: row.id,
      eventId: row.eventId,
      discordUsername: row.discordUsername ?? null,
      discordUserId: row.discordUserId ?? null,
      discordAvatarHash: row.discordAvatarHash ?? null,
      role: row.role as PugRole,
      class: row.class ?? null,
      spec: row.spec ?? null,
      notes: row.notes ?? null,
      status: row.status as 'pending' | 'invited' | 'accepted' | 'claimed',
      serverInviteUrl: row.serverInviteUrl ?? null,
      inviteCode: row.inviteCode ?? null,
      claimedByUserId: row.claimedByUserId ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Generate a unique 8-char invite code (ROK-263).
   * Uses [a-z2-9] charset (no ambiguous chars).
   * Retries on collision (up to 5 times).
   */
  private async generateUniqueInviteCode(maxRetries = 5): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
      const code = this.generateInviteCode();
      const [existing] = await this.db
        .select({ id: schema.pugSlots.id })
        .from(schema.pugSlots)
        .where(eq(schema.pugSlots.inviteCode, code))
        .limit(1);
      if (!existing) return code;
    }
    throw new ConflictException('Failed to generate unique invite code');
  }

  private generateInviteCode(): string {
    const bytes = randomBytes(INVITE_CODE_LENGTH);
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += INVITE_CODE_CHARS[bytes[i] % INVITE_CODE_CHARS.length];
    }
    return code;
  }
}
