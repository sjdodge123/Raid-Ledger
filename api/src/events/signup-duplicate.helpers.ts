import { eq, and } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { BenchPromotionService } from './bench-promotion.service';
import { assignExistingSignupSlot } from './signup-slot.helpers';
import { getCharacterById } from './signup-roster.helpers';
import { buildSignupResponse } from './signup-response.helpers';
import type { CreateSignupDto, SignupResponseDto } from '@raid-ledger/contract';

type EventRow = typeof schema.events.$inferSelect;
type SignupRow = typeof schema.eventSignups.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

async function findExistingSignup(
  tx: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
): Promise<SignupRow> {
  const [existing] = await tx
    .select()
    .from(schema.eventSignups)
    .where(
      and(
        eq(schema.eventSignups.eventId, eventId),
        eq(schema.eventSignups.userId, userId),
      ),
    )
    .limit(1);
  return existing;
}

async function assignIfUnassigned(
  tx: PostgresJsDatabase<typeof schema>,
  event: EventRow,
  eventId: number,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
  benchPromo: BenchPromotionService,
): Promise<void> {
  const existingAssignment = await tx
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, existing.id))
    .limit(1);
  if (existingAssignment.length === 0) {
    await assignExistingSignupSlot(
      tx,
      event,
      eventId,
      existing,
      dto,
      autoBench,
      benchPromo,
    );
  }
}

export async function handleDuplicateSignup(
  tx: PostgresJsDatabase<typeof schema>,
  db: PostgresJsDatabase<typeof schema>,
  eventId: number,
  userId: number,
  event: EventRow,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
  hasCharacter: boolean,
  user: UserRow,
  benchPromo: BenchPromotionService,
): Promise<{ isDuplicate: true; response: SignupResponseDto }> {
  const existing = await findExistingSignup(tx, eventId, userId);
  await reactivateIfCancelled(tx, existing, dto, hasCharacter);
  await updatePreferredRoles(tx, existing, dto);
  await assignIfUnassigned(
    tx,
    event,
    eventId,
    existing,
    dto,
    autoBench,
    benchPromo,
  );

  const character = existing.characterId
    ? await getCharacterById(db, existing.characterId)
    : null;
  return {
    isDuplicate: true as const,
    response: buildSignupResponse(existing, user, character),
  };
}

function isCancelledStatus(status: string): boolean {
  return (
    status === 'roached_out' || status === 'declined' || status === 'departed'
  );
}

function buildReactivationFields(
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  hasCharacter: boolean,
) {
  return {
    status: 'signed_up',
    confirmationStatus: hasCharacter ? 'confirmed' : 'pending',
    note: dto?.note ?? existing.note,
    characterId: dto?.characterId ?? null,
    preferredRoles: dto?.preferredRoles ?? null,
    attendanceStatus: null,
    attendanceRecordedAt: null,
    roachedOutAt: null,
  };
}

function applyReactivationLocally(
  existing: SignupRow,
  fields: ReturnType<typeof buildReactivationFields>,
): void {
  existing.status = fields.status;
  existing.confirmationStatus = fields.confirmationStatus;
  existing.note = fields.note;
  existing.characterId = fields.characterId;
  existing.preferredRoles = fields.preferredRoles;
  existing.attendanceStatus = null;
  existing.attendanceRecordedAt = null;
  existing.roachedOutAt = null;
}

export async function reactivateIfCancelled(
  tx: PostgresJsDatabase<typeof schema>,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
  hasCharacter: boolean,
): Promise<void> {
  if (!isCancelledStatus(existing.status)) return;
  const fields = buildReactivationFields(existing, dto, hasCharacter);
  await tx
    .update(schema.eventSignups)
    .set(fields)
    .where(eq(schema.eventSignups.id, existing.id));
  applyReactivationLocally(existing, fields);
}

export async function updatePreferredRoles(
  tx: PostgresJsDatabase<typeof schema>,
  existing: SignupRow,
  dto: CreateSignupDto | undefined,
): Promise<void> {
  if (isCancelledStatus(existing.status)) return;
  if (!dto?.preferredRoles || dto.preferredRoles.length === 0) return;
  await tx
    .update(schema.eventSignups)
    .set({ preferredRoles: dto.preferredRoles })
    .where(eq(schema.eventSignups.id, existing.id));
  existing.preferredRoles = dto.preferredRoles;
}
