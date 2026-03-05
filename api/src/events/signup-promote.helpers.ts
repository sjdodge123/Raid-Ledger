import { eq, and, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';

export async function promoteGenericSlot(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  slotConfig: Record<string, unknown>,
  username: string,
): Promise<{
  role: string;
  position: number;
  username: string;
  warning?: string;
} | null> {
  const maxPlayers = (slotConfig.player as number) ?? null;

  await deleteBenchAssignment(tx, eventId, signupId);

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
    await reinsertBench(tx, eventId, signupId);
    return {
      role: 'bench',
      position: 1,
      username,
      warning: `All player slots are full — ${username} remains on bench.`,
    };
  }

  const position = findFirstGap(currentPlayers.map((p) => p.position));

  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role: 'player',
    position,
    isOverride: 0,
  });

  await tx
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, signupId));

  return { role: 'player', position, username };
}

export async function detectChainMoves(
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
  const movedEntries = findMovedEntries(before, after, excludeSignupId);
  if (movedEntries.length === 0) return [];

  return resolveMovedUsernames(tx, movedEntries);
}

function findMovedEntries(
  before: Array<{
    signupId: number;
    role: string | null;
  }>,
  after: Array<{
    signupId: number;
    role: string | null;
  }>,
  excludeSignupId: number,
): Array<{ signupId: number; fromRole: string; toRole: string }> {
  const beforeMap = new Map(before.map((a) => [a.signupId, a.role]));
  const entries: Array<{
    signupId: number;
    fromRole: string;
    toRole: string;
  }> = [];

  for (const a of after) {
    if (a.signupId === excludeSignupId) continue;
    const oldRole = beforeMap.get(a.signupId);
    if (oldRole !== undefined && oldRole !== a.role) {
      entries.push({
        signupId: a.signupId,
        fromRole: oldRole ?? 'unknown',
        toRole: a.role ?? 'unknown',
      });
    }
  }

  return entries;
}

async function resolveMovedUsernames(
  tx: PostgresJsDatabase<typeof schema>,
  entries: Array<{
    signupId: number;
    fromRole: string;
    toRole: string;
  }>,
): Promise<
  Array<{
    signupId: number;
    username: string;
    fromRole: string;
    toRole: string;
  }>
> {
  const ids = entries.map((m) => m.signupId);
  const signups = await tx
    .select({
      id: schema.eventSignups.id,
      userId: schema.eventSignups.userId,
      discordUsername: schema.eventSignups.discordUsername,
    })
    .from(schema.eventSignups)
    .where(inArray(schema.eventSignups.id, ids));
  const signupMap = new Map(signups.map((s) => [s.id, s]));

  const userIds = signups
    .filter((s) => !s.discordUsername && s.userId)
    .map((s) => s.userId!);
  const userMap = new Map<number, string>();
  if (userIds.length > 0) {
    const users = await tx
      .select({
        id: schema.users.id,
        username: schema.users.username,
      })
      .from(schema.users)
      .where(inArray(schema.users.id, userIds));
    for (const u of users) userMap.set(u.id, u.username);
  }

  return entries.map((entry) => {
    const signup = signupMap.get(entry.signupId);
    let username = 'Unknown';
    if (signup?.discordUsername) {
      username = signup.discordUsername;
    } else if (signup?.userId) {
      username = userMap.get(signup.userId) ?? 'Unknown';
    }
    return { ...entry, username };
  });
}

export async function resolveGenericSlotRole(
  tx: PostgresJsDatabase<typeof schema>,
  event: { slotConfig: unknown; maxAttendees: number | null },
  eventId: number,
): Promise<string | null> {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  if (slotConfig?.type === 'mmo') return null;

  let maxPlayers: number | null = null;
  if (slotConfig) {
    maxPlayers = (slotConfig.player as number) ?? null;
  } else if (event.maxAttendees) {
    maxPlayers = event.maxAttendees;
  }

  if (maxPlayers === null) return null;

  const current = await tx
    .select({ position: schema.rosterAssignments.position })
    .from(schema.rosterAssignments)
    .where(
      and(
        eq(schema.rosterAssignments.eventId, eventId),
        eq(schema.rosterAssignments.role, 'player'),
      ),
    );

  return current.length >= maxPlayers ? null : 'player';
}

function findFirstGap(positions: number[]): number {
  const occupied = new Set(positions);
  let pos = 1;
  while (occupied.has(pos)) pos++;
  return pos;
}

async function deleteBenchAssignment(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<void> {
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

async function reinsertBench(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
): Promise<void> {
  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role: 'bench',
    position: 1,
  });
}
