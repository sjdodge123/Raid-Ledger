/**
 * ROK-1417 (plan B4) — game-binding join decision core, extracted from
 * voice-state-join.handlers.ts so the per-outcome `traceGate` wiring fits under
 * the 300-line file cap. Each terminal branch emits exactly one gate trace; the
 * null-game monitor branch (ROK-1415 tolerance) also escalates via
 * `warnInertOnce`. Behaviour is byte-for-byte the pre-1417 logic plus the trace
 * calls — no spawn decision changed.
 */
import type { VoiceMemberInfo } from '../services/ad-hoc-participant.service';
import type { DiscordMemberInfo, ResolvedBinding } from './voice-state.helpers';
import {
  getGameFilteredCount,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import { handleGameSpecificGroupRoster } from './voice-state-recovery.handlers';
import { traceGate, warnInertOnce, type GateCtx } from './voice-gate-trace';

/** Spawn schedule callbacks for a game-specific binding. */
export interface GameSpawnFns {
  scheduleSpawn: () => void;
  cancelSpawn: () => void;
}

/** Build the gate trace context from a resolved binding (+ optional metrics). */
export function gateCtx(
  binding: ResolvedBinding,
  channelId: string,
  extra?: Partial<GateCtx>,
): GateCtx {
  return {
    channelId,
    bindingId: binding.bindingId,
    purpose: binding.bindingPurpose,
    gameId: binding.gameId,
    ...extra,
  };
}

/**
 * Join an existing ad-hoc event for a game binding.
 *
 * `resolvedGameId` (ROK-1394) must match the KEY of the existing event so the
 * join reconciles into it rather than minting a duplicate: `null` targets a
 * degraded Untitled session (`bindingId:null`), a number targets the sticky
 * game event (`bindingId:<gameId>`).
 */
export async function joinExistingEvent(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  uid: number | null,
  resolvedGameId?: number | null,
): Promise<void> {
  const mi: VoiceMemberInfo = { ...dm, userId: uid };
  const handled = await deps.adHocEventService.handleVoiceJoin(
    binding.bindingId,
    mi,
    binding,
    resolvedGameId,
    undefined,
    channelId,
  );
  // Codex P2: only claim the outcome when the service actually processed the
  // join — a kill-switch/suppression gate already traced its own reason.
  if (handled)
    traceGate(deps.logger, 'joined-existing', gateCtx(binding, channelId));
}

/**
 * ROK-959: suppress ad-hoc if a sibling binding has a live scheduled event;
 * otherwise run the threshold check. Split out of handleGameBindingJoin so the
 * suppressed-scheduled trace lands here without growing that (31/30) function.
 */
export async function suppressOrCheckThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  spawnFns?: GameSpawnFns,
): Promise<void> {
  const suppressed = await deps.adHocEventService.trySuppressForScheduled(
    binding.bindingId,
    binding.gameId,
    channelId,
  );
  if (suppressed) {
    traceGate(deps.logger, 'suppressed-scheduled', gateCtx(binding, channelId));
    return;
  }
  await checkGameBindingThreshold(deps, channelId, binding, spawnFns);
}

/** Check threshold and spawn for a game-specific binding. */
async function checkGameBindingThreshold(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  spawnFns?: GameSpawnFns,
): Promise<void> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  if (binding.gameId == null)
    return traceNullGameMonitor(deps, channelId, binding, minPlayers, spawnFns);
  return resolveGameBindingSpawn(
    deps,
    channelId,
    binding,
    minPlayers,
    spawnFns,
  );
}

/**
 * ROK-1415 tolerance + ROK-1417 observability for a null-game monitor: warn
 * once (the inert shape), then arm the delayed spawn at/above threshold or
 * record it inert below. getGameFilteredCount stays untouched — with no bind
 * game nothing can be game-confirmed, so the immediate unanimous path is
 * unreachable by construction and the DELAYED path is always taken.
 */
function traceNullGameMonitor(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  minPlayers: number,
  spawnFns?: GameSpawnFns,
): void {
  const members = deps.channelMembers.get(channelId)?.size ?? 0;
  const ctx = gateCtx(binding, channelId, {
    members,
    minPlayers,
    counted: 0,
    confirmed: 0,
  });
  warnInertOnce(deps.logger, ctx);
  if (members >= minPlayers) {
    spawnFns?.scheduleSpawn();
    return traceGate(deps.logger, 'spawn-scheduled', ctx);
  }
  return traceGate(deps.logger, 'below-threshold-inert', ctx);
}

/** Game-filtered threshold decision for a fixed-game bind + its trace. */
async function resolveGameBindingSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  minPlayers: number,
  spawnFns?: GameSpawnFns,
): Promise<void> {
  const { counted, allConfirmed, confirmedCount } = await getGameFilteredCount(
    deps,
    channelId,
    binding,
  );
  const ctx = gateCtx(binding, channelId, {
    members: deps.channelMembers.get(channelId)?.size,
    minPlayers,
    counted,
    confirmed: confirmedCount,
  });
  if (counted < minPlayers)
    return traceGate(deps.logger, 'below-threshold', ctx);
  if (allConfirmed) {
    spawnFns?.cancelSpawn();
    // allConfirmed ⟹ every counted member confirmed the bound game, so the
    // sticky game is correct and the ROK-1394 degrade is unreachable here.
    const rostered = await handleGameSpecificGroupRoster(
      deps,
      channelId,
      binding,
      undefined,
    );
    // Codex P2: a kill-switch-gated roster must not log a false success line —
    // the service already traced feature-disabled (throttled).
    if (rostered) return traceGate(deps.logger, 'spawned-immediate', ctx);
    return;
  }
  spawnFns?.scheduleSpawn();
  return traceGate(deps.logger, 'spawn-scheduled', ctx);
}
