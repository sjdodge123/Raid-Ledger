/**
 * ROK-1805 — move a general-lobby member onto a detected game's group, the
 * way `moveToNewGame` does for a presence switch: leave any OTHER game's event
 * on the binding, then stop the old game's voice activity before starting the
 * new one. Shared by the server-presence re-evaluation (every branch: below
 * threshold, delayed, immediate) and the group roster (a delayed spawn that
 * fires after the member switched). Each switch leaves the member's current
 * event on the binding and closes the old game's voice play-time session.
 */
import type { ResolvedBinding } from './voice-state.helpers';
import {
  startVoiceGameTracking,
  stopVoiceGameTracking,
  type VoiceHandlerDeps,
} from './voice-state.handlers';

/** The game a member is being moved onto. */
export interface SwitchTarget {
  gameId: number | null;
  gameName: string;
}

/**
 * Leave the member's current event on this binding unless it IS the target
 * game's event, then retrack. Codex r4 P2 1 + P2 2.
 */
export async function switchLobbyMemberGame(
  deps: VoiceHandlerDeps,
  binding: ResolvedBinding,
  memberId: string,
  target: SwitchTarget,
  rlUserId: number | null,
): Promise<void> {
  const svc = deps.adHocEventService;
  const targetState = svc.getActiveState(binding.bindingId, target.gameId);
  if (!targetState?.memberSet.has(memberId))
    await svc.handleVoiceLeave(binding.bindingId, memberId);
  retrackVoiceGame(deps, memberId, target, rlUserId);
}

/**
 * Start voice tracking for `target`, first closing a different game's open
 * voice session (Codex r4 P2 2 — a bare start overwrote the tracker and left
 * the old game's session open). The same game keeps its session untouched. Review
 * MINOR 1: games compare by id — the roster and presence paths can name the
 * same game differently ('Unknown game' vs the rich-presence name).
 */
export function retrackVoiceGame(
  deps: VoiceHandlerDeps,
  memberId: string,
  target: SwitchTarget,
  rlUserId: number | null,
): void {
  const current = deps.voiceGameTracker.get(memberId);
  // Same game id: keep the open session as is. GameActivityService keys a
  // session by user + activity NAME, so restarting under another display name
  // would orphan the first session (Codex ROK-1805 r2 P2).
  if (current?.gameId === target.gameId) return;
  if (current) stopVoiceGameTracking(deps, memberId);
  startVoiceGameTracking(
    deps,
    memberId,
    target.gameId,
    target.gameName,
    rlUserId,
  );
}
