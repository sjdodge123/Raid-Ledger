import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { PUG_SLOT_EVENTS } from '../discord-bot/discord-bot.constants';
import {
  generateUniqueInviteCode,
  toPugSlotResponse,
  findPugSlotOrThrow,
  verifyEventPermission,
  verifyEventExists,
  handleUniqueConstraint,
} from './pugs.helpers';
import type {
  CreatePugSlotDto,
  UpdatePugSlotDto,
  PugSlotResponseDto,
  PugSlotListResponseDto,
} from '@raid-ledger/contract';

export interface PugSlotCreatedPayload {
  pugSlotId: string;
  eventId: number;
  discordUsername: string | null;
  creatorUserId: number;
}

@Injectable()
export class PugsService {
  private readonly logger = new Logger(PugsService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(
    eventId: number,
    userId: number,
    isAdmin: boolean,
    dto: CreatePugSlotDto,
  ): Promise<PugSlotResponseDto> {
    await verifyEventExists(this.db, eventId);
    const inviteCode = await generateUniqueInviteCode(this.db);
    try {
      const inserted = await this.insertPugSlot(
        eventId,
        userId,
        dto,
        inviteCode,
      );
      this.emitIfNamed(inserted, eventId, userId);
      return toPugSlotResponse(inserted);
    } catch (error: unknown) {
      handleUniqueConstraint(error, dto.discordUsername);
    }
  }

  private async insertPugSlot(
    eventId: number,
    userId: number,
    dto: CreatePugSlotDto,
    inviteCode: string,
  ) {
    const [inserted] = await this.db
      .insert(schema.pugSlots)
      .values({
        eventId,
        discordUsername: dto.discordUsername ?? null,
        role: dto.role,
        class: dto.class ?? null,
        spec: dto.spec ?? null,
        notes: dto.notes ?? null,
        status: 'pending',
        inviteCode,
        createdBy: userId,
      })
      .returning();
    const label = inserted.discordUsername ?? `anonymous (${inviteCode})`;
    this.logger.log(
      `PUG slot created: ${label} as ${dto.role} for event ${eventId}`,
    );
    return inserted;
  }

  private emitIfNamed(
    inserted: typeof schema.pugSlots.$inferSelect,
    eventId: number,
    userId: number,
  ): void {
    if (!inserted.discordUsername) return;
    this.eventEmitter.emit(PUG_SLOT_EVENTS.CREATED, {
      pugSlotId: inserted.id,
      eventId,
      discordUsername: inserted.discordUsername,
      creatorUserId: userId,
    } satisfies PugSlotCreatedPayload);
  }

  async regenerateInviteCode(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
  ): Promise<PugSlotResponseDto> {
    await verifyEventPermission(this.db, eventId, userId, isAdmin);
    await findPugSlotOrThrow(this.db, eventId, pugId);
    const newCode = await generateUniqueInviteCode(this.db);
    const [updated] = await this.db
      .update(schema.pugSlots)
      .set({ inviteCode: newCode, updatedAt: new Date() })
      .where(eq(schema.pugSlots.id, pugId))
      .returning();
    this.logger.log(
      `Regenerated invite code for PUG slot ${pugId}: ${newCode}`,
    );
    return toPugSlotResponse(updated);
  }

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

  async findAll(eventId: number): Promise<PugSlotListResponseDto> {
    await verifyEventExists(this.db, eventId);
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
    return { pugs: pugs.map(toPugSlotResponse) };
  }

  async update(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
    dto: UpdatePugSlotDto,
  ): Promise<PugSlotResponseDto> {
    await verifyEventPermission(this.db, eventId, userId, isAdmin);
    await findPugSlotOrThrow(this.db, eventId, pugId);
    const updateData = buildPugUpdateData(dto);
    try {
      const [updated] = await this.db
        .update(schema.pugSlots)
        .set(updateData)
        .where(eq(schema.pugSlots.id, pugId))
        .returning();
      this.logger.log(`PUG slot ${pugId} updated for event ${eventId}`);
      return toPugSlotResponse(updated);
    } catch (error: unknown) {
      handleUniqueConstraint(error, dto.discordUsername);
    }
  }

  async remove(
    eventId: number,
    pugId: string,
    userId: number,
    isAdmin: boolean,
  ): Promise<void> {
    const existing = await findPugSlotOrThrow(this.db, eventId, pugId);
    if (existing.createdBy !== userId) {
      await verifyEventPermission(this.db, eventId, userId, isAdmin);
    }
    await this.db.delete(schema.pugSlots).where(eq(schema.pugSlots.id, pugId));
    this.logger.log(
      `PUG slot ${pugId} (${existing.discordUsername}) removed from event ${eventId}`,
    );
  }
}

function buildPugUpdateData(dto: UpdatePugSlotDto): Record<string, unknown> {
  const data: Record<string, unknown> = { updatedAt: new Date() };
  if (dto.discordUsername !== undefined)
    data.discordUsername = dto.discordUsername;
  if (dto.role !== undefined) data.role = dto.role;
  if (dto.class !== undefined) data.class = dto.class;
  if (dto.spec !== undefined) data.spec = dto.spec;
  if (dto.notes !== undefined) data.notes = dto.notes;
  return data;
}
