import type { GuildMember } from 'discord.js';
import {
  resolveVoiceChannel,
  spawnTimerKey,
  type ResolvedBinding,
} from './voice-state.helpers';
import type { AdHocEventService } from '../services/ad-hoc-event.service';
import type { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import {
  markLobbyDirty,
  stopVoiceGameTracking,
  trackScheduledEventLeave,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import { executeDelayedSpawn } from './voice-state-join.handlers';
import { resolveLobbyGroups } from './voice-lobby-groups.helpers';

/** Discord member info shape used for scheduling. */
type DiscordMember = {
  discordUserId: string;
  discordUsername: string;
  discordAvatarHash: string | null;
};

/** Timer state maps owned by the listener. */
export interface TimerMaps {
  pendingRechecks: Map<string, NodeJS.Timeout>;
  pendingSpawnTimers: Map<string, NodeJS.Timeout>;
}

/** Handle a member leaving a voice channel. */
export async function handleChannelLeave(
  deps: VoiceHandlerDeps,
  channelId: string,
  userId: string,
  timers: TimerMaps,
  adHocEventService: AdHocEventService,
  resolveBindingFn: (ch: string) => Promise<ResolvedBinding | null>,
): Promise<void> {
  cancelPendingRecheck(timers, userId);
  stopVoiceGameTracking(deps, userId);
  try {
    await trackScheduledEventLeave(deps, channelId, userId);
  } catch (err) {
    deps.logger.error(`Leave tracking failed for ${userId}: ${err}`);
  }
  const binding = await resolveBindingFn(channelId);
  if (!binding) return;
  await removeChannelMember(deps, channelId, binding, userId, timers);
  // ROK-1446 D6: leave is shared by both binding kinds, so the lobby gate in
  // `markLobbyDirty` is what keeps monitor channels out (D1).
  markLobbyDirty(deps, binding, channelId);
  await adHocEventService.handleVoiceLeave(binding.bindingId, userId);
}

/** Cancel a pending presence recheck timer. */
function cancelPendingRecheck(timers: TimerMaps, userId: string): void {
  const recheck = timers.pendingRechecks.get(userId);
  if (recheck) {
    clearTimeout(recheck);
    timers.pendingRechecks.delete(userId);
  }
}

/** Remove a member from channel tracking and cancel spawns that no longer hold. */
async function removeChannelMember(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  userId: string,
  timers: TimerMaps,
): Promise<void> {
  const members = deps.channelMembers.get(channelId);
  if (members) {
    members.delete(userId);
    if (members.size === 0) deps.channelMembers.delete(channelId);
  }
  // ROK-1445 review LOW-3: the per-group cancel is driven by live presence, not
  // by `channelMembers`, so an absent occupancy entry must not skip it.
  if (binding.bindingPurpose === 'general-lobby') {
    await cancelUnqualifiedLobbySpawns(deps, channelId, binding, timers);
    return;
  }
  if (!members) return;
  if (members.size < (binding.config?.minPlayers ?? 2))
    cancelPendingSpawn(timers, channelId, binding.gameId);
}

/**
 * ROK-1445 AC14: the leave gate is per GROUP, not per channel. One person
 * leaving a 5-person room must not cancel the pending spawn of a game group
 * that still clears `minPlayers` — only the group they left behind is cancelled.
 */
async function cancelUnqualifiedLobbySpawns(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  timers: TimerMaps,
): Promise<void> {
  // ROK-1445 review LOW-2: on a Discord cache miss the channel is
  // unresolvable, `resolveLobbyGroups` yields zero groups, and the prefix scan
  // below would cancel EVERY pending spawn on this channel with nothing left to
  // re-arm them until a fresh join. When membership cannot be determined the
  // safe default is to cancel NOTHING.
  if (!resolveVoiceChannel(deps.clientService, channelId)) return;
  const { qualifying } = await resolveLobbyGroups(deps, channelId, binding);
  const keep = new Set(
    qualifying.map((g) => spawnTimerKey(channelId, g.gameId)),
  );
  const prefix = `${channelId}:`;
  for (const key of [...timers.pendingSpawnTimers.keys()]) {
    if (!key.startsWith(prefix) || keep.has(key)) continue;
    clearTimeout(timers.pendingSpawnTimers.get(key));
    timers.pendingSpawnTimers.delete(key);
  }
}

/** Cancel the pending spawn timer armed for one `(channel, game)` group. */
export function cancelPendingSpawn(
  timers: TimerMaps,
  channelId: string,
  gameId: number | null,
): void {
  const key = spawnTimerKey(channelId, gameId);
  const timer = timers.pendingSpawnTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.pendingSpawnTimers.delete(key);
  }
}

/**
 * Schedule a delayed spawn for ONE `(channel, game)` group.
 *
 * ROK-1445 AC13: the map used to be keyed by channel alone, so once the first
 * qualifying group armed its timer the second could never arm one and silently
 * never spawned. The composite key is what makes N concurrent events possible.
 */
export function scheduleDelayedSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  gameId: number | null,
  binding: ResolvedBinding,
  timers: TimerMaps,
  delayMs: number,
): void {
  const key = spawnTimerKey(channelId, gameId);
  if (timers.pendingSpawnTimers.has(key)) return;
  const timer = setTimeout(() => {
    timers.pendingSpawnTimers.delete(key);
    executeDelayedSpawn(deps, channelId, gameId, binding).catch((e) =>
      deps.logger.error(`Delayed spawn error for ${key}: ${e}`),
    );
  }, delayMs);
  timers.pendingSpawnTimers.set(key, timer);
}

/** Context for scheduling a presence recheck. */
export interface RecheckContext {
  timers: TimerMaps;
  dm: DiscordMember;
  channelId: string;
  guildMember: GuildMember;
  userChannelMap: Map<string, string>;
  presenceDetector: PresenceGameDetectorService;
  handleJoinFn: (
    ch: string,
    d: DiscordMember,
    g?: GuildMember,
  ) => Promise<void>;
  logError: (msg: string) => void;
}

/** Schedule a presence recheck for a member. */
export function schedulePresenceRecheck(ctx: RecheckContext): void {
  const existing = ctx.timers.pendingRechecks.get(ctx.dm.discordUserId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    ctx.timers.pendingRechecks.delete(ctx.dm.discordUserId);
    if (ctx.userChannelMap.get(ctx.dm.discordUserId) !== ctx.channelId) return;
    ctx.presenceDetector
      .detectGameForMember(ctx.guildMember)
      .then(async (d) => {
        if (d.gameId !== null)
          await ctx.handleJoinFn(ctx.channelId, ctx.dm, ctx.guildMember);
      })
      .catch((e) =>
        ctx.logError(`Recheck failed for ${ctx.dm.discordUserId}: ${e}`),
      );
  }, 7000);
  ctx.timers.pendingRechecks.set(ctx.dm.discordUserId, timer);
}
