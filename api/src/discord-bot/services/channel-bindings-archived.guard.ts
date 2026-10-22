/**
 * ROK-1428 Codex r11 P2 — an ARCHIVED managed binding must stay a lifecycle
 * candidate. Re-pointing it to another purpose (e.g. quick-play-announcements)
 * or clearing its game drops it out of `selectCandidateBindings`, so the
 * channel would stay hidden / read-only forever with nothing left to
 * unarchive it. Such edits are refused until the channel is unarchived.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { BindingUpdatePatch } from './channel-bindings-invariant.helpers';

/** 400 text for a purpose change / game clear on an archived binding. */
export const ARCHIVED_REROUTE_REFUSED =
  'This channel is archived. It is restored automatically when its game sees activity again — change its purpose or game after that.';

/** Throw 400 when the patch would take an archived binding out of the lifecycle. */
export function assertArchivedBindingStaysRouted(
  existing: {
    lifecycleState?: string | undefined;
    bindingPurpose: string;
    gameId?: number | null;
  },
  patch: BindingUpdatePatch,
): void {
  if (existing.lifecycleState !== 'archived') return;
  const purpose = patch.bindingPurpose ?? existing.bindingPurpose;
  const gameId = patch.gameIdProvided
    ? (patch.gameId ?? null)
    : (existing.gameId ?? null);
  if (purpose !== 'game-announcements' || gameId === null) {
    throw new BadRequestException(ARCHIVED_REROUTE_REFUSED);
  }
}

/** True when the patch can move the binding's (purpose, game) routing. */
function touchesRouting(patch: BindingUpdatePatch): boolean {
  return patch.bindingPurpose !== undefined || patch.gameIdProvided === true;
}

/**
 * ROK-1428 Codex r12 P2 — the pre-check above reads the row unlocked, so a
 * PATCH racing the reconcile's archive could pass it and commit its re-point
 * after the archive. The UPDATE therefore re-asserts the rule atomically: a
 * routing patch only writes a row that is not archived, or whose resolved
 * (purpose, game) stays a lifecycle candidate. A config-only patch is
 * unconstrained (it cannot leave the lifecycle).
 */
export function bindingUpdateWhere(
  id: string,
  patch: BindingUpdatePatch,
): SQL | undefined {
  const b = schema.channelBindings;
  const byId = eq(b.id, id);
  if (!touchesRouting(patch)) return byId;
  const purposeOk =
    patch.bindingPurpose === undefined
      ? sql`${b.bindingPurpose} = 'game-announcements'`
      : patch.bindingPurpose === 'game-announcements';
  const gameOk = patch.gameIdProvided
    ? (patch.gameId ?? null) !== null
    : sql`${b.gameId} IS NOT NULL`;
  if (purposeOk === true && gameOk === true) return byId;
  const notArchived = sql`${b.lifecycleState} <> 'archived'`;
  if (purposeOk === false || gameOk === false) return and(byId, notArchived);
  const keeps = [purposeOk, gameOk].filter((c): c is SQL => c !== true);
  return and(byId, sql`(${notArchived} OR (${sql.join(keeps, sql` AND `)}))`);
}

/**
 * The guarded UPDATE matched no row: when the patch moved routing and the row
 * still exists, it was archived under us — refuse with the same 400 the
 * pre-check gives. Otherwise the row is gone and the caller returns null.
 */
export async function refuseIfArchivedRace(
  patch: BindingUpdatePatch,
  stillExists: () => Promise<unknown>,
): Promise<void> {
  if (touchesRouting(patch) && (await stillExists())) {
    throw new BadRequestException(ARCHIVED_REROUTE_REFUSED);
  }
}
