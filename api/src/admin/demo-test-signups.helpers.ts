/**
 * DEMO_MODE-only helpers for signup smoke-test fixtures.
 * Extracted from demo-test.service.ts (ROK-1072) to keep the service a thin
 * facade. Pure functions over passed-in moduleRef/db handles.
 */
import type { ModuleRef } from '@nestjs/core';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import type { SignupStatus } from '../drizzle/schema/event-signups';
import type { CreateSignupDto, SignupResponseDto } from '@raid-ledger/contract';
import { SignupsService } from '../events/signups.service';
import { SignupsRosterService } from '../events/signups-roster.service';
import { DepartureGraceQueueService } from '../discord-bot/queues/departure-grace.queue';

type Db = PostgresJsDatabase<typeof schema>;

/** Optional overrides accepted by createSignupForTest. */
export interface CreateSignupForTestDto {
  preferredRoles?: string[];
  characterId?: string;
  status?: SignupStatus;
}

/** Build a CreateSignupDto, filtering preferredRoles to valid values. */
export function buildSignupDto(dto?: {
  preferredRoles?: string[];
  characterId?: string;
}): CreateSignupDto | undefined {
  if (!dto) return undefined;
  const validRoles = new Set(['tank', 'healer', 'dps']);
  const filtered = dto.preferredRoles?.filter((r) =>
    validRoles.has(r),
  ) as CreateSignupDto['preferredRoles'];
  return {
    preferredRoles: filtered?.length ? filtered : undefined,
    characterId: dto.characterId,
  };
}

/** Directly update a signup's status in the DB. */
async function overrideSignupStatus(
  db: Db,
  signupId: number,
  status: SignupStatus,
): Promise<void> {
  await db
    .update(schema.eventSignups)
    .set({ status })
    .where(eq(schema.eventSignups.id, signupId));
}

/** Create a signup for any user (smoke tests). */
export async function createSignupForTest(
  moduleRef: ModuleRef,
  db: Db,
  eventId: number,
  userId: number,
  dto?: CreateSignupForTestDto,
): Promise<SignupResponseDto> {
  const svc = moduleRef.get(SignupsService, { strict: false });
  const signupDto = buildSignupDto(dto);
  const result = await svc.signup(eventId, userId, signupDto, {
    skipEndedCheck: true,
  });
  if (dto?.status && dto.status !== 'signed_up') {
    await overrideSignupStatus(db, result.id, dto.status);
  }
  return result;
}

/** Enqueue a departure grace job with 0ms delay. */
export async function triggerDepartureForTest(
  moduleRef: ModuleRef,
  eventId: number,
  signupId: number,
  discordUserId: string,
): Promise<void> {
  const queueSvc = moduleRef.get(DepartureGraceQueueService, {
    strict: false,
  });
  await queueSvc.enqueue({ eventId, signupId, discordUserId }, 0);
}

/** Cancel a signup as if the user did it — triggers bufferLeave. */
export async function cancelSignupForTest(
  moduleRef: ModuleRef,
  eventId: number,
  userId: number,
): Promise<void> {
  const svc = moduleRef.get(SignupsRosterService, { strict: false });
  await svc.cancel(eventId, userId);
}
