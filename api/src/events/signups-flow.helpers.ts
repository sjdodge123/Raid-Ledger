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
import * as cancelH from './signups-cancel.helpers';
import * as rosterH from './signups-roster.helpers';
import * as rosterQH from './signups-roster-query.helpers';

type Tx = PostgresJsDatabase<typeof schema>;
type Logger = {
  log: (msg: string, ...a: unknown[]) => void;
  warn: (msg: string, ...a: unknown[]) => void;
};

export interface FlowDeps {
  db: Tx;
  logger: Logger;
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
  await signupH.reactivateIfCancelled(tx, existing, dto, p.hasCharacter);
  await signupH.updatePreferredRolesIfNeeded(tx, existing, dto);
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
    ? await cancelH.getCharacterById(tx, existing.characterId)
    : null;
  return {
    isDuplicate: true as const,
    response: rosterH.buildSignupResponseDto(existing, user, character),
  };
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
    if (dto?.slotRole) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [dto.slotRole] })
        .where(eq(schema.eventSignups.id, existing.id));
    }
    await deps.autoAllocateSignup(tx, eventId, existing.id, slotConfig);
    await signupH.syncConfirmationStatus(tx, existing);
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
    const slotConfig = eventRow.slotConfig as Record<string, unknown> | null;
    if (dto?.slotRole) {
      await tx
        .update(schema.eventSignups)
        .set({ preferredRoles: [dto.slotRole] })
        .where(eq(schema.eventSignups.id, inserted.id));
    }
    await deps.autoAllocateSignup(tx, eventId, inserted.id, slotConfig);
    await signupH.syncConfirmationStatus(tx, inserted);
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
  return { isDuplicate: false as const, signup: inserted };
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
    return discordH.fetchExistingDiscordSignup(tx, eventId, dto.discordUserId);
  }
  const [inserted] = rows;
  const slotConfig = event.slotConfig as Record<string, unknown> | null;
  const isMMO = slotConfig?.type === 'mmo';
  const hasPrefs = dto.preferredRoles && dto.preferredRoles.length > 0;
  const hasSingleRole = !hasPrefs && dto.role;
  if (isMMO && (hasPrefs || hasSingleRole)) {
    await discordH.allocateMmoDiscordSlot(
      tx,
      eventId,
      inserted.id,
      dto,
      hasSingleRole,
      (t, eId, sId, sc) => deps.autoAllocateSignup(t, eId, sId, sc),
      slotConfig,
    );
  } else {
    await discordH.allocateGenericDiscordSlot(
      tx,
      event,
      eventId,
      inserted.id,
      dto,
      isMMO,
      hasPrefs,
      hasSingleRole,
      (t, ev, eId) => rosterQH.resolveGenericSlotRole(t, ev, eId),
      (t, eId, role) => rosterQH.findNextPosition(t, eId, role),
    );
  }
  deps.logger.log(
    `Anonymous Discord user ${dto.discordUsername} (${dto.discordUserId}) signed up for event ${eventId}`,
  );
  return inserted;
}
