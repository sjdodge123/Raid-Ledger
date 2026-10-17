/**
 * ROK-1825 — who may read a PUG slot's invite credentials.
 *
 * A slot's `inviteCode` claims that slot, and `serverInviteUrl` is a guild
 * invite the manager generated for one person. Only the event's managers —
 * the same creator-or-operator/admin rule `verifyEventPermission` enforces on
 * every mutating PUG route — may read them.
 */
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { PugSlotResponseDto } from '@raid-ledger/contract';
import * as schema from '../drizzle/schema';

/** The signed-in caller reading a PUG list; null = no manager rights. */
export type PugViewer = { id: number; isAdmin: boolean } | null;

/** True when the user created the event or is an operator/admin. */
export function canManageEvent(
  creatorId: number,
  userId: number,
  isAdmin: boolean,
): boolean {
  return creatorId === userId || isAdmin;
}

/** Strip invite credentials from every slot unless the viewer manages the event. */
export function projectPugSlotsForViewer(
  slots: PugSlotResponseDto[],
  creatorId: number,
  viewer: PugViewer,
): PugSlotResponseDto[] {
  if (viewer && canManageEvent(creatorId, viewer.id, viewer.isAdmin)) {
    return slots;
  }
  return slots.map((s) => ({ ...s, inviteCode: null, serverInviteUrl: null }));
}

/** The event's creator id; 404 when the event does not exist. */
export async function findEventCreatorIdOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<number> {
  const [event] = await db
    .select({ creatorId: schema.events.creatorId })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) {
    throw new NotFoundException(`Event with ID ${eventId} not found`);
  }
  return event.creatorId;
}
