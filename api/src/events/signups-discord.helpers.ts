/**
 * Discord signup flow helpers for SignupsService.
 * Contains anonymous Discord participant insert and allocation logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq, and, ne, isNull } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type {
  CreateDiscordSignupDto,
  SignupResponseDto,
} from '@raid-ledger/contract';
import type { Tx, EventRow } from './signups.service.types';
import * as cancelH from './signups-cancel.helpers';
import * as rosterH from './signups-roster.helpers';
import {
  resolveGenericSlotRole,
  findNextPosition,
} from './signups-roster-query.helpers';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';

export async function findLinkedUser(db: Tx, discordUserId: string) {
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.discordId, discordUserId))
    .limit(1);
  return user ?? null;
}

export async function insertDiscordSignupRow(
  tx: Tx,
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
      target: [schema.eventSignups.eventId, schema.eventSignups.discordUserId],
    })
    .returning();
}

export async function fetchExistingDiscordSignup(
  tx: Tx,
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

export async function findActiveAnonymousSignup(
  db: Tx,
  eventId: number,
  discordUserId: string,
) {
  const { NotFoundException } = await import('@nestjs/common');
  const [signup] = await db
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

export async function claimAnonymousSignupsQuery(
  db: Tx,
  discordUserId: string,
  userId: number,
) {
  return db
    .update(schema.eventSignups)
    .set({ userId })
    .where(
      and(
        eq(schema.eventSignups.discordUserId, discordUserId),
        isNull(schema.eventSignups.userId),
      ),
    )
    .returning();
}

export async function allocateMmoDiscordSlot(
  tx: Tx,
  eventId: number,
  signupId: number,
  dto: CreateDiscordSignupDto,
  hasSingleRole: string | undefined | false,
  autoAllocate: (
    tx: Tx,
    eventId: number,
    signupId: number,
    slotConfig: Record<string, unknown> | null,
  ) => Promise<void>,
  slotConfig: Record<string, unknown> | null,
) {
  if (hasSingleRole && dto.role) {
    await tx
      .update(schema.eventSignups)
      .set({ preferredRoles: [dto.role] })
      .where(eq(schema.eventSignups.id, signupId));
  }
  await autoAllocate(tx, eventId, signupId, slotConfig);
}

export async function allocateGenericDiscordSlot(
  tx: Tx,
  event: EventRow,
  eventId: number,
  signupId: number,
  dto: CreateDiscordSignupDto,
  isMMO: boolean,
  hasPrefs: boolean | undefined,
  hasSingleRole: string | undefined | false,
  resolveGenericRole: (
    tx: Tx,
    event: EventRow,
    eventId: number,
  ) => Promise<string | null>,
  findNextPos: (tx: Tx, eventId: number, slotRole: string) => Promise<number>,
) {
  const assignRole =
    !isMMO || (!hasPrefs && !hasSingleRole)
      ? (dto.role ?? (await resolveGenericRole(tx, event, eventId)))
      : null;
  if (!assignRole) return;

  const position = await findNextPos(tx, eventId, assignRole);
  await tx.insert(schema.rosterAssignments).values({
    eventId,
    signupId,
    role: assignRole,
    position,
    isOverride: 0,
  });
}

export async function findByDiscordUserFlow(
  db: Tx,
  eventId: number,
  discordUserId: string,
): Promise<SignupResponseDto | null> {
  const linkedUser = await findLinkedUser(db, discordUserId);
  if (linkedUser) {
    const [signup] = await db
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
      ? await cancelH.getCharacterById(db, signup.characterId)
      : null;
    return rosterH.buildSignupResponseDto(signup, linkedUser, character);
  }
  const [signup] = await db
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
  return rosterH.buildAnonymousSignupResponseDto(signup);
}

export async function buildStatusUpdateResponse(
  db: Tx,
  updated: typeof schema.eventSignups.$inferSelect,
): Promise<SignupResponseDto> {
  if (updated.userId) {
    const user = await cancelH.fetchUserById(db, updated.userId);
    const character = updated.characterId
      ? await cancelH.getCharacterById(db, updated.characterId)
      : null;
    return rosterH.buildSignupResponseDto(updated, user, character);
  }
  return rosterH.buildAnonymousSignupResponseDto(updated);
}

export async function cancelByDiscordUserFlow(
  db: Tx,
  eventId: number,
  discordUserId: string,
  logger: { log: (msg: string, ...a: unknown[]) => void },
  emitter: { emit: (event: string, payload: unknown) => void },
) {
  const signup = await findActiveAnonymousSignup(db, eventId, discordUserId);
  const cancelInfo = await cancelH.resolveCancelStatus(db, eventId);
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signup.id));
  await db
    .update(schema.eventSignups)
    .set({
      status: cancelInfo.cancelStatus,
      roachedOutAt: cancelInfo.isGracefulDecline ? null : cancelInfo.now,
    })
    .where(eq(schema.eventSignups.id, signup.id));
  logger.log(
    `Anonymous Discord user ${discordUserId} canceled signup for event ${eventId} (${cancelInfo.cancelStatus})`,
  );
  emitter.emit(SIGNUP_EVENTS.DELETED, {
    eventId,
    signupId: signup.id,
    action: 'discord_signup_cancelled',
  });
}

/** Normal (non-bench) slot allocation for anonymous Discord signups. */
export async function allocateDiscordSlot(
  tx: Tx,
  event: EventRow,
  eventId: number,
  inserted: typeof schema.eventSignups.$inferSelect,
  dto: CreateDiscordSignupDto,
  autoAllocate: (
    t: Tx,
    e: number,
    s: number,
    c: Record<string, unknown> | null,
  ) => Promise<void>,
): Promise<void> {
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  const isMMO = slotConfig?.type === 'mmo';
  const hasPrefs = dto.preferredRoles && dto.preferredRoles.length > 0;
  const hasSingleRole = !hasPrefs && dto.role;
  if (isMMO && (hasPrefs || hasSingleRole)) {
    await allocateMmoDiscordSlot(
      tx,
      eventId,
      inserted.id,
      dto,
      hasSingleRole,
      autoAllocate,
      slotConfig,
    );
  } else {
    await allocateGenericDiscordSlot(
      tx,
      event,
      eventId,
      inserted.id,
      dto,
      isMMO,
      hasPrefs,
      hasSingleRole,
      (t, ev, eId) => resolveGenericSlotRole(t, ev, eId),
      (t, eId, role) => findNextPosition(t, eId, role),
    );
  }
}
