/**
 * Signup flow orchestration helpers for SignupsService.
 * Contains signup, discord signup, cancel, confirm, and status update logic.
 * Extracted from signups.service.ts for file size compliance (ROK-719).
 */
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import type {
  CreateSignupDto,
  CreateDiscordSignupDto,
} from '@raid-ledger/contract';
import type {
  SignupTxParams,
  DuplicateSignupParams,
  DirectSlotParams,
  NewSignupParams,
} from './signups.service.types';
import * as signupH from './signups-signup.helpers';
import * as discordH from './signups-discord.helpers';
import { getCharacterById } from './signups-cancel.helpers';
import { buildSignupResponseDto } from './signups-roster.helpers';
import * as rosterQH from './signups-roster-query.helpers';

type Tx = PostgresJsDatabase<typeof schema>;

export interface FlowDeps {
  db: Tx;
  logger: {
    log: (msg: string, ...a: unknown[]) => void;
    warn: (msg: string, ...a: unknown[]) => void;
  };
  cancelPromotion: (
    eventId: number,
    role: string,
    position: number,
  ) => Promise<void>;
  autoAllocateSignup: (
    tx: Tx,
    eventId: number,
    signupId: number,
    slotConfig: Record<string, unknown> | null,
  ) => Promise<void>;
}

export async function signupTxBody(deps: FlowDeps, p: SignupTxParams) {
  const { tx, eventRow, eventId, userId, dto } = p;
  const autoBench = await signupH.checkAutoBench(tx, eventRow, eventId, dto);
  const hasCharacter = !!dto?.characterId;
  const rows = await signupH.insertSignupRow(tx, eventId, userId, dto);
  if (rows.length === 0) {
    return handleDuplicateSignup(deps, {
      ...p,
      autoBench,
      hasCharacter,
    });
  }
  return handleNewSignup(deps, {
    tx,
    eventRow,
    eventId,
    userId,
    inserted: rows[0],
    dto,
    autoBench,
  });
}

async function handleDuplicateSignup(deps: FlowDeps, p: DuplicateSignupParams) {
  const { tx, eventRow, eventId, userId, dto, user } = p;
  const existing = await signupH.fetchExistingSignup(tx, eventId, userId);
  // reactivateIfCancelled mutates `existing` in-place (including characterId).
  // updateCharacterIfNeeded's equality guard relies on this — it's a no-op for
  // the reactivation path because existing.characterId is already synced.
  await signupH.reactivateIfCancelled(tx, existing, dto, p.hasCharacter);
  await signupH.updateCharacterIfNeeded(tx, existing, dto);
  const rolesChanged = await signupH.updatePreferredRolesIfNeeded(
    tx,
    existing,
    dto,
  );
  if (rolesChanged) await clearExistingAssignment(tx, existing.id);
  await ensureAssignment(
    deps,
    tx,
    eventRow,
    eventId,
    existing,
    dto,
    p.autoBench,
  );
  const character = existing.characterId
    ? await getCharacterById(tx, existing.characterId)
    : null;
  return {
    isDuplicate: true as const,
    response: buildSignupResponseDto(existing, user, character),
  };
}

async function clearExistingAssignment(tx: Tx, signupId: number) {
  await tx
    .delete(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId));
}

async function ensureAssignment(
  deps: FlowDeps,
  tx: Tx,
  eventRow: typeof schema.events.$inferSelect,
  eventId: number,
  existing: typeof schema.eventSignups.$inferSelect,
  dto: CreateSignupDto | undefined,
  autoBench: boolean,
) {
  const [existingAssignment] = await tx
    .select()
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, existing.id))
    .limit(1);
  if (existingAssignment) return;
  if (signupH.shouldUseAutoAllocation(eventRow, existing, dto, autoBench)) {
    const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
    const hasPrefs =
      existing.preferredRoles && existing.preferredRoles.length > 0;
    if (!hasPrefs && dto?.slotRole) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [dto.slotRole] })
        .where(eq(schema.eventSignups.id, existing.id));
    }
    await deps.autoAllocateSignup(tx, eventId, existing.id, slotConfig);
    const hasAssignment = await checkHasAssignment(tx, existing.id);
    if (hasAssignment) {
      await signupH.syncConfirmationStatus(tx, existing);
    } else {
      await assignBenchFallback(deps, tx, eventId, existing.id);
    }
  } else {
    const confirmed = await assignDirectSlot(deps, {
      tx,
      eventRow,
      eventId,
      signupId: existing.id,
      dto,
      autoBench,
      logPrefix: `Re-assigned user ${existing.userId}`,
    });
    if (confirmed) existing.confirmationStatus = 'confirmed';
  }
}

export async function assignDirectSlot(
  deps: FlowDeps,
  p: DirectSlotParams,
): Promise<boolean> {
  const { tx, eventRow, eventId, signupId, dto, autoBench, logPrefix } = p;
  const slotRole = autoBench
    ? 'bench'
    : (dto?.slotRole ??
      (await rosterQH.resolveGenericSlotRole(tx, eventRow, eventId)));
  if (!slotRole) return false;
  const position = await rosterQH.findNextPosition(
    tx,
    eventId,
    slotRole,
    dto?.slotPosition,
    autoBench,
  );
  await tx
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role: slotRole, position, isOverride: 0 });
  if (slotRole !== 'bench') {
    await tx
      .update(schema.eventSignups)
      .set({ confirmationStatus: 'confirmed' })
      .where(eq(schema.eventSignups.id, signupId));
    await deps.cancelPromotion(eventId, slotRole, position);
  }
  deps.logger.log(
    `${logPrefix} to ${slotRole} slot ${position}${autoBench ? ' (auto-benched)' : ''}`,
  );
  return slotRole !== 'bench';
}

async function handleNewSignup(deps: FlowDeps, p: NewSignupParams) {
  const { tx, eventRow, eventId, userId, inserted, dto, autoBench } = p;
  deps.logger.log(`User ${userId} signed up for event ${eventId}`);
  if (signupH.shouldUseAutoAllocationNew(eventRow, dto, autoBench)) {
    await runAutoAllocWithBenchFallback(
      deps,
      tx,
      eventRow,
      eventId,
      inserted,
      dto,
    );
  } else {
    const confirmed = await assignDirectSlot(deps, {
      tx,
      eventRow,
      eventId,
      signupId: inserted.id,
      dto,
      autoBench,
      logPrefix: `Assigned user ${userId}`,
    });
    if (confirmed) inserted.confirmationStatus = 'confirmed';
  }
  await signupH.autoConfirmCreator(tx, eventRow, userId, inserted);
  const assignedSlot = await rosterQH.getAssignedSlotRole(tx, inserted.id);
  return { isDuplicate: false as const, signup: inserted, assignedSlot };
}

/** Run MMO auto-allocation, then bench-fallback if no assignment was made. */
async function runAutoAllocWithBenchFallback(
  deps: FlowDeps,
  tx: Tx,
  eventRow: typeof schema.events.$inferSelect,
  eventId: number,
  inserted: typeof schema.eventSignups.$inferSelect,
  dto: CreateSignupDto | undefined,
): Promise<void> {
  const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
  const hasPrefs = dto?.preferredRoles && dto.preferredRoles.length > 0;
  if (!hasPrefs && dto?.slotRole) {
    await tx
      .update(schema.eventSignups)
      .set({ preferredRoles: [dto.slotRole] })
      .where(eq(schema.eventSignups.id, inserted.id));
  }
  await deps.autoAllocateSignup(tx, eventId, inserted.id, slotConfig);
  const hasAssignment = await checkHasAssignment(tx, inserted.id);
  if (hasAssignment) {
    await signupH.syncConfirmationStatus(tx, inserted);
  } else {
    await assignBenchFallback(deps, tx, eventId, inserted.id);
  }
}

/** Check whether a signup has any roster assignment. */
async function checkHasAssignment(tx: Tx, signupId: number): Promise<boolean> {
  const [row] = await tx
    .select({ id: schema.rosterAssignments.id })
    .from(schema.rosterAssignments)
    .where(eq(schema.rosterAssignments.signupId, signupId))
    .limit(1);
  return !!row;
}

/** Assign a signup to the bench as a fallback (ROK-626). */
export async function assignBenchFallback(
  deps: FlowDeps,
  tx: Tx,
  eventId: number,
  signupId: number,
  label = 'signup',
): Promise<void> {
  const position = await rosterQH.findNextPosition(
    tx,
    eventId,
    'bench',
    undefined,
    true,
  );
  await tx
    .insert(schema.rosterAssignments)
    .values({ eventId, signupId, role: 'bench', position, isOverride: 0 });
  deps.logger.log(
    `Auto-benched ${label} ${signupId} at bench position ${position}`,
  );
}

export async function discordSignupTxBody(
  deps: FlowDeps,
  tx: Tx,
  event: typeof schema.events.$inferSelect,
  eventId: number,
  dto: CreateDiscordSignupDto,
) {
  const rows = await discordH.insertDiscordSignupRow(tx, eventId, dto);
  if (rows.length === 0) {
    const existing = await discordH.fetchExistingDiscordSignup(
      tx,
      eventId,
      dto.discordUserId,
    );
    const assignedSlot = await rosterQH.getAssignedSlotRole(tx, existing.id);
    return { signup: existing, assignedSlot };
  }
  const [inserted] = rows;
  const autoBench = await signupH.checkAutoBench(tx, event, eventId);
  if (autoBench) {
    await assignBenchFallback(
      deps,
      tx,
      eventId,
      inserted.id,
      'anonymous signup',
    );
  } else {
    await discordH.allocateDiscordSlot(
      tx,
      event,
      eventId,
      inserted,
      dto,
      (t, eId, sId, sc) => deps.autoAllocateSignup(t, eId, sId, sc),
    );
  }
  deps.logger.log(
    `Anonymous Discord user ${dto.discordUsername} (${dto.discordUserId}) signed up for event ${eventId}`,
  );
  const assignedSlot = await rosterQH.getAssignedSlotRole(tx, inserted.id);
  return { signup: inserted, assignedSlot };
}
