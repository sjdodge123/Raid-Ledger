import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { buildSignupResponse } from './signup-response.helpers';
import {
  getCharacterById,
  cleanupMatchingPugSlots,
} from './signup-roster.helpers';
import { assignNewSignupSlot, checkAutoBench } from './signup-slot.helpers';
import { handleDuplicateSignup } from './signup-duplicate.helpers';
import type { SignupResponseDto, CreateSignupDto } from '@raid-ledger/contract';

const logger = new Logger('SignupCore');

type EventRow = typeof schema.events.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;
type SignupRow = typeof schema.eventSignups.$inferSelect;

type SignupResult =
  | { isDuplicate: true; response: SignupResponseDto }
  | { isDuplicate: false; signup: SignupRow; response: SignupResponseDto };

export async function performSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  dto: CreateSignupDto | undefined,
  benchPromo: BenchPromotionService,
): Promise<SignupResult> {
  const prep = await prepareSignup(db, eventId, userId, dto?.characterId);
  const args: SignupTxArgs = { db, eventId, userId, benchPromo, dto, ...prep };
  const result = await executeSignupTx(args);
  if (result.isDuplicate) return result;
  const response = await buildNewSignupResponse(
    db,
    eventId,
    userId,
    result.signup,
    prep.user,
    dto?.characterId,
  );
  return { isDuplicate: false, signup: result.signup, response };
}

type SignupTxArgs = {
  db: PostgresJsDatabase<typeof schema>;
  eventId: number;
  userId: number;
  event: EventRow;
  user: UserRow;
  benchPromo: BenchPromotionService;
  dto?: CreateSignupDto;
};

export async function executeSignupTx(args: SignupTxArgs) {
  const { db } = args;
  return db.transaction((tx) => executeSignupTxBody(tx, args));
}

async function executeSignupTxBody(
  tx: PostgresJsDatabase<typeof schema>,
  args: SignupTxArgs,
) {
  const { eventId, userId, event, dto } = args;
  const autoBench = await checkAutoBench(tx, event, eventId, dto);
  const rows = await insertSignupRow(
    tx,
    eventId,
    userId,
    dto,
    !!dto?.characterId,
  );
  if (rows.length === 0) return onDuplicate(tx, args, autoBench);
  return processNewSignup(
    tx,
    event,
    eventId,
    userId,
    rows[0],
    dto,
    autoBench,
    args.benchPromo,
  );
}

async function onDuplicate(
  tx: PostgresJsDatabase<typeof schema>,
  args: SignupTxArgs,
  autoBench: boolean,
) {
  const { db, eventId, userId, event, dto, user, benchPromo } = args;
  return handleDuplicateSignup(
    tx,
    db,
    eventId,
    userId,
    event,
    dto,
    autoBench,
    !!dto?.characterId,
    user,
    benchPromo,
  );
}

async function insertSignupRow(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  dto: CreateSignupDto | undefined,
  hasCharacter: boolean,
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

async function processNewSignup(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  userId: number,
  inserted: typeof schema.eventSignups.$inferSelect,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
  benchPromo: BenchPromotionService,
) {
  logger.log(`User ${userId} signed up for event ${eventId}`);
  await assignNewSignupSlot(
    tx,
    event,
    eventId,
    inserted,
    dto,
    autoBench,
    benchPromo,
  );
  await autoConfirmCreator(tx, event, userId, inserted);
  return { isDuplicate: false as const, signup: inserted };
}

async function autoConfirmCreator(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  userId: number,
  inserted: typeof schema.eventSignups.$inferSelect,
): Promise<void> {
  if (event.creatorId !== userId || inserted.confirmationStatus === 'confirmed')
    return;
  await tx
    .update(schema.eventSignups)
    .set({ confirmationStatus: 'confirmed' })
    .where(eq(schema.eventSignups.id, inserted.id));
  inserted.confirmationStatus = 'confirmed';
}

export async function buildNewSignupResponse(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  signup: typeof schema.eventSignups.$inferSelect,
  user: UserRow,
  characterId?: string | null,
): Promise<SignupResponseDto> {
  cleanupMatchingPugSlots(db, eventId, userId).catch((err) =>
    logger.warn(
      'Failed to cleanup PUG slots for user %d on event %d: %s',
      userId,
      eventId,
      err instanceof Error ? err.message : 'Unknown error',
    ),
  );
  const character = characterId
    ? await getCharacterById(db, characterId)
    : null;
  return buildSignupResponse(signup, user, character);
}

export async function prepareSignup(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  characterId?: string | null,
): Promise<{ event: EventRow; user: UserRow }> {
  const event = await findEventOrThrow(db, eventId);
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  if (characterId) await validateCharacterOwnership(db, characterId, userId);
  return { event, user };
}

export async function findEventOrThrow(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
): Promise<EventRow> {
  const [event] = await db
    .select()
    .from(schema.events)
    .where(eq(schema.events.id, eventId))
    .limit(1);
  if (!event) throw new NotFoundException(`Event with ID ${eventId} not found`);
  return event;
}

export async function validateCharacterOwnership(
  db: PostgresJsDatabase<typeof schema>,
  characterId: string,
  userId: number,
): Promise<typeof schema.characters.$inferSelect> {
  const [character] = await db
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

export async function findSignupByIdentifier(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  identifier: { userId?: number; discordUserId?: string },
): Promise<typeof schema.eventSignups.$inferSelect> {
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

  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(and(...conditions))
    .limit(1);
  if (!signup) throw new NotFoundException('Signup not found');
  return signup;
}
