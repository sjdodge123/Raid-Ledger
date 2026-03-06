import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type { PugSlotResponseDto, PugRole } from '@raid-ledger/contract';

type SlotRow = typeof schema.pugSlots.$inferSelect;

const INVITE_CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz2345679';
const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_CODE_CHARS[bytes[i] % INVITE_CODE_CHARS.length];
  }
  return code;
}

export async function generateUniqueInviteCode(
  db: PostgresJsDatabase<typeof schema>,
  maxRetries = 5,
): Promise<string> {
  for (let i = 0; i < maxRetries; i++) {
    const code = generateInviteCode();
    const [existing] = await db
      .select({ id: schema.pugSlots.id })
      .from(schema.pugSlots)
      .where(eq(schema.pugSlots.inviteCode, code))
      .limit(1);
    if (!existing) return code;
  }
  throw new ConflictException('Failed to generate unique invite code');
}

export function toPugSlotResponse(row: SlotRow): PugSlotResponseDto {
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

export async function findPugSlotOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  pugId: string,
): Promise<SlotRow> {
  const [existing] = await db
    .select()
    .from(schema.pugSlots)
    .where(
      and(eq(schema.pugSlots.id, pugId), eq(schema.pugSlots.eventId, eventId)),
    )
    .limit(1);
  if (!existing) {
    throw new NotFoundException(
      `PUG slot ${pugId} not found for event ${eventId}`,
    );
  }
  return existing;
}

export async function verifyEventPermission(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  isAdmin: boolean,
): Promise<void> {
  const [event] = await db
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

export async function verifyEventExists(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<void> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) {
    throw new NotFoundException(`Event with ID ${eventId} not found`);
  }
}

export function handleUniqueConstraint(
  error: unknown,
  username?: string,
): never {
  if (error instanceof Error && error.message.includes('unique_event_pug')) {
    throw new ConflictException(
      `Discord user "${username}" is already a PUG for this event`,
    );
  }
  throw error;
}
