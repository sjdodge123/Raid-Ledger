/**
 * ROK-1428 Codex r11 P2 — an ARCHIVED managed binding must stay a lifecycle
 * candidate. Re-pointing it to another purpose (e.g. quick-play-announcements)
 * or clearing its game drops it out of `selectCandidateBindings`, so the
 * channel would stay hidden / read-only forever with nothing left to
 * unarchive it. Such edits are refused until the channel is unarchived.
 */
import { BadRequestException } from '@nestjs/common';
import type { BindingUpdatePatch } from './channel-bindings-invariant.helpers';

/** 400 text for a purpose change / game clear on an archived binding. */
export const ARCHIVED_REROUTE_REFUSED =
  'This channel is archived. Unarchive it before changing its purpose or clearing its game.';

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
