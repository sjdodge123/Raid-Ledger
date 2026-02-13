import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import type {
  CreatePugSlotDto,
  UpdatePugSlotDto,
  PugSlotResponseDto,
  PugSlotListResponseDto,
} from '@raid-ledger/contract';

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
    // Verify event exists and user has permission
    await this.verifyEventPermission(eventId, userId, isAdmin);

    try {
      const [inserted] = await this.db
        .insert(schema.pugSlots)
        .values({
          eventId,
          discordUsername: dto.discordUsername,
          role: dto.role,
          class: dto.class ?? null,
          spec: dto.spec ?? null,
          notes: dto.notes ?? null,
          status: 'pending',
          createdBy: userId,
        })
        .returning();

      this.logger.log(
        `PUG slot created: ${dto.discordUsername} as ${dto.role} for event ${eventId}`,
      );

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

    const pugs = await this.db
      .select()
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.eventId, eventId))
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
   * Convert a database row to PugSlotResponseDto.
   */
  private toPugSlotResponse(
    row: typeof schema.pugSlots.$inferSelect,
  ): PugSlotResponseDto {
    return {
      id: row.id,
      eventId: row.eventId,
      discordUsername: row.discordUsername,
      discordUserId: row.discordUserId ?? null,
      discordAvatarHash: row.discordAvatarHash ?? null,
      role: row.role as 'tank' | 'healer' | 'dps',
      class: row.class ?? null,
      spec: row.spec ?? null,
      notes: row.notes ?? null,
      status: row.status as 'pending' | 'invited' | 'accepted' | 'claimed',
      claimedByUserId: row.claimedByUserId ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
