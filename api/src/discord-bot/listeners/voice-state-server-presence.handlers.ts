/**
 * ROK-1801 layer D — re-evaluate voice rooms when game-server presence changes.
 *
 * `SERVER_PRESENCE_EVENTS.CHANGED` (`{pelicanServerId, gameId}`) fires once
 * per net-change batch, after the Quick Play sink has run. Every occupied
 * room's lobby card is marked dirty (server players render on it), and the
 * threshold is re-run for that game: a monitor bound to the game re-checks
 * (or joins its members into an event the server path just spawned); a
 * general lobby re-checks that game's group with the unchanged immediate /
 * 15-minute rules (Q6), joining new voice members into a running event and
 * cancelling the pending spawn when departures drop the group below threshold.
 */
import type { ServerPresenceChangedPayload } from '../../plugins/pelican/presence/server-presence.reader';
import {
  buildDiscordMember,
  isLobbyBinding,
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  handlePresenceChange,
  markLobbyDirty,
  shouldSpawnImmediately,
} from './voice-state.handlers';
import { suppressOrCheckThreshold } from './voice-state-gate.handlers';
import { handleGameBindingJoin } from './voice-state-join.handlers';
import { handleGeneralLobbyGroupDetection } from './voice-state-recovery.handlers';
import {
  resolveLobbyGroups,
  type LobbyGameGroup,
} from './voice-lobby-groups.helpers';
import { groupSize } from './voice-lobby-server-merge.helpers';
import { serverAwareGameCount } from './voice-threshold-server-count.helpers';
import {
  lobbySpawnFns,
  monitorSpawnFns,
  type JoinHandlerCtx,
} from './voice-state-join-dispatch.handlers';

/** Re-evaluate every occupied voice room for the changed game. Never throws. */
export async function handleServerPresenceChanged(
  ctx: JoinHandlerCtx,
  { gameId }: ServerPresenceChangedPayload,
): Promise<void> {
  const rooms = [...ctx.channelMembers]
    .filter(([, members]) => members.size > 0)
    .map(([chId]) => chId);
  for (const chId of rooms) {
    try {
      await reevaluateRoom(ctx, chId, gameId);
    } catch (err) {
      ctx.logger.warn(`[server-presence] re-evaluate ${chId} failed: ${err}`);
    }
  }
}

/** Every binding on one room; a lobby outranks its monitors (ROK-1782). */
async function reevaluateRoom(
  ctx: JoinHandlerCtx,
  chId: string,
  gameId: number,
): Promise<void> {
  const bindings = await ctx.resolveAllBindings(chId);
  const lobbyWins = bindings.some(isLobbyBinding);
  for (const b of bindings) {
    if (isLobbyBinding(b)) await reevaluateLobby(ctx, chId, b, gameId);
    else if (!lobbyWins && b.gameId === gameId)
      await reevaluateMonitor(ctx, chId, b);
  }
}

/**
 * No event yet → the threshold check (immediate or 15-min), after cancelling
 * a pending spawn that a server departure dropped below `minPlayers` (the
 * monitor twin of the lobby cancel below). An event exists (e.g. the server
 * path just spawned it) → join the room's members into it.
 */
async function reevaluateMonitor(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
): Promise<void> {
  const svc = ctx.deps.adHocEventService;
  const spawnFns = monitorSpawnFns(ctx, chId, b);
  const active = svc.getActiveBindingEventGameId(b.bindingId);
  if (!active) {
    if (await monitorBelowThreshold(ctx, chId, b)) spawnFns.cancelSpawn();
    return suppressOrCheckThreshold(ctx.deps, chId, b, spawnFns);
  }
  const state = svc.getActiveState(b.bindingId, active.gameId);
  const channel = resolveVoiceChannel(ctx.deps.clientService, chId);
  for (const id of [...(ctx.channelMembers.get(chId) ?? [])]) {
    if (state?.memberSet.has(id)) continue;
    const dm = buildDiscordMember(id, channel?.members.get(id));
    await handleGameBindingJoin(ctx.deps, chId, b, dm, spawnFns);
  }
}

/**
 * Voice + server tally below `minPlayers`? An unresolvable channel is never
 * "below" — the departure path owns occupancy-only cancels.
 */
async function monitorBelowThreshold(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
): Promise<boolean> {
  if (!resolveVoiceChannel(ctx.deps.clientService, chId)) return false;
  const { counted } = await serverAwareGameCount(ctx.deps, chId, b);
  return counted < (b.config?.minPlayers ?? 2);
}

/**
 * Card refresh, then that game's group threshold with the Q6 rules. An event
 * already running → reconcile the room against it (Codex P2 / r3 P2). Below
 * the threshold → cancel this game's pending spawn, as a voice departure would.
 */
async function reevaluateLobby(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
  gameId: number,
): Promise<void> {
  markLobbyDirty(ctx.deps, b, chId);
  const state = ctx.deps.adHocEventService.getActiveState(b.bindingId, gameId);
  if (state) return reconcileLobbyEvent(ctx, chId, b, gameId, state.memberSet);
  const fns = lobbySpawnFns(ctx, chId, b);
  const group = await lobbyGroupOf(ctx, chId, b, gameId);
  if (!group || groupSize(group) < (b.config?.minPlayers ?? 2))
    return fns.cancelSpawn(gameId);
  // Review MINOR 3: a server-only group (Q1) renders on the card, but its
  // spawn belongs to the server path — a lobby timer would roster nobody.
  if (group.memberIds.length === 0) return;
  if (await shouldSpawnImmediately(ctx.deps, chId, b)) {
    fns.cancelSpawn(gameId);
    return spawnLobbyGroup(ctx, chId, b, gameId, group.memberIds);
  }
  fns.scheduleSpawn(gameId);
}

/**
 * Codex r3 P2: the spawn branch's members may still sit in another game's
 * event (they switched by joining this game's server, presence unchanged).
 * Each leaves it first — the same `handleVoiceLeave` the presence-switch path
 * runs before a move. Not `handlePresenceChange` per member: the first call
 * would mint this game's event and roster the rest before they had left.
 */
async function spawnLobbyGroup(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
  gameId: number,
  memberIds: readonly string[],
): Promise<void> {
  for (const id of memberIds)
    await ctx.deps.adHocEventService.handleVoiceLeave(b.bindingId, id);
  await handleGeneralLobbyGroupDetection(ctx.deps, chId, b, gameId);
}

/**
 * Reconcile the room against the game's running lobby event through the
 * presence-switch path (its detection merges server presence, and it leaves
 * before it joins):
 * - Codex r2 P2 — a group member not yet in the event (they joined this
 *   game's server) moves in, leaving their prior game event first.
 * - Codex r3 P2 — an event member still in voice but no longer in the group
 *   (they left this game's server, presence unchanged) moves out to whatever
 *   their presence now says, instead of keeping the event's attendance.
 */
async function reconcileLobbyEvent(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
  gameId: number,
  joined: ReadonlySet<string>,
): Promise<void> {
  const channel = resolveVoiceChannel(ctx.deps.clientService, chId);
  if (!channel) return;
  const group = new Set((await lobbyGroupOf(ctx, chId, b, gameId))?.memberIds);
  const joiners = [...group].filter((id) => !joined.has(id));
  const leavers = [...joined].filter((id) => !group.has(id));
  for (const id of [...leavers, ...joiners]) {
    const gm = channel.members.get(id);
    if (gm) await handlePresenceChange(ctx.deps, id, b, gm);
  }
}

/** This lobby's detected group for `gameId` (voice + server), if any. */
async function lobbyGroupOf(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
  gameId: number,
): Promise<LobbyGameGroup | undefined> {
  const { qualifying, dropped } = await resolveLobbyGroups(ctx.deps, chId, b);
  return [...qualifying, ...dropped].find((g) => g.gameId === gameId);
}
