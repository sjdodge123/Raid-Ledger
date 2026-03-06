import { Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import {
  buildSignupResponse,
  buildAnonymousSignupResponse,
} from './signup-response.helpers';
import { getCharacterById } from './signup-roster.helpers';
import { validateCharacterOwnership } from './signup-core.helpers';
import { findSignupByIdentifier } from './signup-core.helpers';
import { checkTentativeDisplacement } from './signup-tentative-reslot.helpers';
import type {
  SignupResponseDto,
  ConfirmSignupDto,
  ConfirmationStatus,
  UpdateSignupStatusDto,
} from '@raid-ledger/contract';

const logger = new Logger('SignupConfirm');

export async function findSignupForConfirm(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  userId: number,
): Promise<typeof schema.eventSignups.$inferSelect> {
  const [signup] = await db
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.id, signupId),
        eq(schema.eventSignups.eventId, eventId),
      ),
    )
    .limit(1);
  if (!signup)
    throw new NotFoundException(
      `Signup ${signupId} not found for event ${eventId}`,
    );
  if (signup.userId !== userId)
    throw new ForbiddenException('You can only confirm your own signup');
  return signup;
}

export async function confirmSignupFlow(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  userId: number,
  dto: ConfirmSignupDto,
): Promise<SignupResponseDto> {
  const signup = await findSignupForConfirm(db, eventId, signupId, userId);
  const character = await validateCharacterOwnership(
    db,
    dto.characterId,
    userId,
  );
  const newStatus: ConfirmationStatus =
    signup.confirmationStatus === 'pending' ? 'confirmed' : 'changed';
  return applyConfirmation(
    db,
    signupId,
    userId,
    dto.characterId,
    newStatus,
    character,
  );
}

async function applyConfirmation(
  db: PostgresJsDatabase<typeof schema>,
  signupId: number,
  userId: number,
  characterId: string,
  newStatus: ConfirmationStatus,
  character: typeof schema.characters.$inferSelect,
): Promise<SignupResponseDto> {
  const [updated] = await db
    .update(schema.eventSignups)
    .set({ characterId, confirmationStatus: newStatus })
    .where(eq(schema.eventSignups.id, signupId))
    .returning();
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  logger.log(
    `User ${userId} confirmed signup ${signupId} with character ${characterId}`,
  );
  return buildSignupResponse(updated, user, character);
}

export async function buildStatusResponse(
  db: PostgresJsDatabase<typeof schema>,
  updated: typeof schema.eventSignups.$inferSelect,
): Promise<SignupResponseDto> {
  if (updated.userId) {
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, updated.userId))
      .limit(1);
    const character = updated.characterId
      ? await getCharacterById(db, updated.characterId)
      : null;
    return buildSignupResponse(updated, user, character);
  }
  return buildAnonymousSignupResponse(updated);
}

export async function updateSignupStatus(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupIdentifier: { userId?: number; discordUserId?: string },
  dto: UpdateSignupStatusDto,
  benchPromo: BenchPromotionService,
): Promise<{
  updated: typeof schema.eventSignups.$inferSelect;
  response: SignupResponseDto;
}> {
  const signup = await findSignupByIdentifier(db, eventId, signupIdentifier);
  const [updated] = await db
    .update(schema.eventSignups)
    .set({ status: dto.status })
    .where(eq(schema.eventSignups.id, signup.id))
    .returning();
  logger.log(
    `Signup ${signup.id} status updated to ${dto.status} for event ${eventId}`,
  );
  fireTentativeCheck(db, eventId, signup.id, dto.status, benchPromo);
  const response = await buildStatusResponse(db, updated);
  return { updated, response };
}

function fireTentativeCheck(
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  signupId: number,
  status: string,
  benchPromo: BenchPromotionService,
): void {
  if (status !== 'tentative') return;
  checkTentativeDisplacement(db, eventId, signupId, benchPromo).catch(
    (err: unknown) =>
      logger.warn(
        `ROK-459: Failed tentative displacement check: ${err instanceof Error ? err.message : 'Unknown error'}`,
      ),
  );
}
