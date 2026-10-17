/**
 * Bench promotion helpers for SignupsService.
 * Contains promote from bench, generic/MMO slot promotion logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq, and, sql, inArray } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { Tx } from './signups.service.types';
import type {
  PromotionResult,
  RosterSnapshot,
  ChainMove,
} from './signups-allocation.helpers';
import { findFirstGap, findRoleChanges } from './signups-allocation.helpers';

export async function fetchSlotConfig(tx: Tx, eventId: number) {
  const [event] = await tx
    .select({ slotConfig: schema.events.slotConfig })
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  return (event?.slotConfig as Record<string, unknown>) ?? null;
}

export async function fetchPromotionSignup(tx: Tx, signupId: number) {
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

export async function resolveSignupUsername(tx: Tx, userId: number | null) {
  if (!userId) return 'Bench player';
  const [user] = await tx
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  return user?.username ?? 'Bench player';
}

export async function snapshotNonBenchAssignments(tx: Tx, eventId: number) {
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

export async function deleteBenchAssignment(
  tx: Tx,
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

export async function fetchCurrentAssignment(
  tx: Tx,
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

export async function handleFailedPromotion(
  tx: Tx,
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

export async function fetchPlayerPositions(tx: Tx, eventId: number) {
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

export async function restoreBenchAfterFailedGeneric(
  tx: Tx,
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

export async function promoteGenericSlot(
  tx: Tx,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  username: string,
): Promise<PromotionResult | null> {
  const maxPlayers = (slotConfig.player as number) ?? null;
  await deleteBenchAssignment(tx, eventId, signupId);
  const currentPlayers = await fetchPlayerPositions(tx, eventId);
  if (maxPlayers !== null && currentPlayers.length >= maxPlayers) {
    return restoreBenchAfterFailedGeneric(tx, eventId, signupId, username);
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

export async function detectChainMoves(
  tx: Tx,
  before: RosterSnapshot[],
  after: RosterSnapshot[],
  excludeSignupId: number,
): Promise<ChainMove[]> {
  const movedEntries = findRoleChanges(before, after, excludeSignupId);
  if (movedEntries.length === 0) return [];
  const usernameMap = await batchFetchUsernames(
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

async function batchFetchUsernames(
  tx: Tx,
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
  const userMap = await fetchUserMap(tx, userIds);
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

async function fetchUserMap(
  tx: Tx,
  userIds: number[],
): Promise<Map<number, string>> {
  if (userIds.length === 0) return new Map();
  const users = await tx
    .select({ id: schema.users.id, username: schema.users.username })
    .from(schema.users)
    .where(inArray(schema.users.id, userIds));
  return new Map(users.map((u) => [u.id, u.username]));
}
