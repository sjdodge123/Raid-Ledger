import { NotFoundException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, and, ne } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import {
  buildAnonymousSignupResponse,
  buildSignupResponse,
} from './signup-response.helpers';
import { getCharacterById } from './signup-roster.helpers';
import { assignDiscordSignupSlot } from './signup-slot.helpers';
import { SIGNUP_EVENTS } from '../discord-bot/discord-bot.constants';
import type { SignupEventPayload } from '../discord-bot/discord-bot.constants';
import { determineCancelStatus } from './signup-cancel.helpers';
import type {
  SignupResponseDto,
  CreateDiscordSignupDto,
} from '@raid-ledger/contract';

const logger = new Logger('SignupDiscord');

type EventRow = typeof schema.events.$inferSelect;

async function insertDiscordSignup(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  dto: CreateDiscordSignupDto,
): Promise<(typeof schema.eventSignups.$inferSelect)[]> {
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

async function findExistingDiscordSignup(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  discordUserId: string,
): Promise<typeof schema.eventSignups.$inferSelect> {
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

export async function executeDiscordSignupTx(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  event: EventRow,
  dto: CreateDiscordSignupDto,
  benchPromo: BenchPromotionService,
): Promise<typeof schema.eventSignups.$inferSelect> {
  return db.transaction(async (tx) => {
    const rows = await insertDiscordSignup(tx, eventId, dto);
    if (rows.length === 0)
      return findExistingDiscordSignup(tx, eventId, dto.discordUserId);

    const [inserted] = rows;
    await assignDiscordSignupSlot(
      tx,
      event,
      eventId,
      inserted.id,
      dto.role,
      dto.preferredRoles,
      benchPromo,
    );
    logger.log(
      `Anonymous Discord user ${dto.discordUsername} (${dto.discordUserId}) signed up for event ${eventId}`,
    );
    return inserted;
  });
}

export async function findActiveDiscordSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  discordUserId: string,
): Promise<typeof schema.eventSignups.$inferSelect> {
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

export async function findLinkedUserSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  linkedUser: typeof schema.users.$inferSelect,
): Promise<SignupResponseDto | null> {
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
    ? await getCharacterById(db, signup.characterId)
    : null;
  return buildSignupResponse(signup, linkedUser, character);
}

export async function findAnonymousDiscordSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  discordUserId: string,
): Promise<SignupResponseDto | null> {
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
  return buildAnonymousSignupResponse(signup);
}

export async function cancelByDiscordUser(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  discordUserId: string,
  eventEmitter: EventEmitter2,
): Promise<void> {
  const signup = await findActiveDiscordSignup(db, eventId, discordUserId);
  const { cancelStatus, isGracefulDecline } = await determineCancelStatus(
    db,
    eventId,
  );
  await db
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signup.id));
  await db
    .update(schema.eventSignups)
    .set({
      status: cancelStatus,
      roachedOutAt: isGracefulDecline ? null : new Date(),
    })
    .where(eq(schema.eventSignups.id, signup.id));
  logger.log(
    `Anonymous Discord user ${discordUserId} canceled signup for event ${eventId} (${cancelStatus})`,
  );
  eventEmitter.emit(SIGNUP_EVENTS.DELETED, {
    eventId,
    signupId: signup.id,
    action: 'discord_signup_cancelled',
  } satisfies SignupEventPayload);
}
