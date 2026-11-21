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
import { RunningLateService } from '../events/running-late.service';
import { z } from 'zod';
import type { SetSignupStatusTestBody } from './demo-test.schemas';

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

/** Body of `POST /admin/test/running-late` (ROK-2271). */
export const RunningLateTestSchema = z.object({
  eventId: z.number().int().positive(),
  userId: z.number().int().positive(),
  minutes: z.number().int().min(1).max(240).optional(),
  clear: z.boolean().optional(),
});
export type RunningLateTestBody = z.infer<typeof RunningLateTestSchema>;

/**
 * Mark (or clear) a signup as running late through the REAL service, so the
 * urgent signup emit fires exactly as the DM button does (ROK-2271).
 * `changed` is false when the row was already in that state or is missing.
 */
export async function setRunningLateForTest(
  moduleRef: ModuleRef,
  body: RunningLateTestBody,
): Promise<{ changed: boolean }> {
  const svc = moduleRef.get(RunningLateService, { strict: false });
  const changed = body.clear
    ? await svc.clearRunningLate(body.eventId, body.userId)
    : await svc.setRunningLate(body.eventId, body.userId, body.minutes);
  return { changed };
}

/**
 * Change any user's signup status through the REAL service call the
 * `PATCH /events/:id/signup/status` route makes for the caller, so
 * `SIGNUP_EVENTS.UPDATED` fires (ROK-2275).
 */
export async function setSignupStatusForTest(
  moduleRef: ModuleRef,
  body: SetSignupStatusTestBody,
): Promise<SignupResponseDto> {
  const svc = moduleRef.get(SignupsService, { strict: false });
  return svc.updateStatus(
    body.eventId,
    { userId: body.userId },
    { status: body.status },
  );
}
