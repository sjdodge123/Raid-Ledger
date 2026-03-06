import type { GuildMember } from 'discord.js';
import type { ResolvedBinding } from './voice-state.helpers';
import type { AdHocEventService } from '../services/ad-hoc-event.service';
import type { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import {
  stopVoiceGameTracking,
  trackScheduledEventLeave,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import { executeDelayedSpawn } from './voice-state-join.handlers';

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
  removeChannelMember(deps.channelMembers, channelId, binding, userId, timers);
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

/** Remove a member from channel tracking and cancel spawn if below threshold. */
function removeChannelMember(
  channelMembers: Map<string, Set<string>>,
  channelId: string,
  binding: ResolvedBinding,
  userId: string,
  timers: TimerMaps,
): void {
  const members = channelMembers.get(channelId);
  if (!members) return;
  members.delete(userId);
  if (members.size === 0) channelMembers.delete(channelId);
  if (members.size < (binding.config?.minPlayers ?? 2))
    cancelPendingSpawn(timers, channelId);
}

/** Cancel a pending spawn timer for a channel. */
export function cancelPendingSpawn(timers: TimerMaps, channelId: string): void {
  const timer = timers.pendingSpawnTimers.get(channelId);
  if (timer) {
    clearTimeout(timer);
    timers.pendingSpawnTimers.delete(channelId);
  }
}

/** Schedule a delayed spawn for a channel. */
export function scheduleDelayedSpawn(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  timers: TimerMaps,
  delayMs: number,
): void {
  if (timers.pendingSpawnTimers.has(channelId)) return;
  const timer = setTimeout(() => {
    timers.pendingSpawnTimers.delete(channelId);
    executeDelayedSpawn(deps, channelId, binding).catch((e) =>
      deps.logger.error(`Delayed spawn error for ${channelId}: ${e}`),
    );
  }, delayMs);
  timers.pendingSpawnTimers.set(channelId, timer);
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
