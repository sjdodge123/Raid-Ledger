/**
 * Voice-channel join dispatch handlers, extracted from VoiceStateListener for
 * file-size compliance (mirrors voice-state-leave.handlers.ts). These walk the
 * bindings for a joined channel and route to the game-binding / general-lobby
 * handlers. handleChannelJoin is re-entrant (presence recheck re-invokes it).
 */
import type { GuildMember } from 'discord.js';
import type { Logger } from '@nestjs/common';
import type { PresenceGameDetectorService } from '../services/presence-game-detector.service';
import {
  trackChannelMember,
  type DiscordMemberInfo,
  type ResolvedBinding,
} from './voice-state.helpers';
import {
  trackScheduledEventJoin,
  type VoiceHandlerDeps,
} from './voice-state.handlers';
import {
  handleGameBindingJoin,
  handleGeneralLobbyJoin,
} from './voice-state-join.handlers';
import {
  cancelPendingSpawn,
  scheduleDelayedSpawn,
  schedulePresenceRecheck,
  type TimerMaps,
} from './voice-state-leave.handlers';

const SPAWN_DELAY_MS = 15 * 60 * 1000;

/** Listener state the join dispatch needs, passed in to keep these pure. */
export interface JoinHandlerCtx {
  deps: VoiceHandlerDeps;
  timers: TimerMaps;
  channelMembers: Map<string, Set<string>>;
  userChannelMap: Map<string, string>;
  presenceDetector: PresenceGameDetectorService;
  logger: Logger;
  resolveAllBindings: (ch: string) => Promise<ResolvedBinding[]>;
}

/** Resolve bindings for a joined channel and dispatch each. */
export async function handleChannelJoin(
  ctx: JoinHandlerCtx,
  chId: string,
  dm: DiscordMemberInfo,
  gm?: GuildMember,
): Promise<void> {
  try {
    await trackScheduledEventJoin(ctx.deps, chId, dm);
  } catch (err) {
    ctx.logger.error(`Join tracking failed for ${dm.discordUserId}: ${err}`);
  }
  const bindings = await ctx.resolveAllBindings(chId);
  if (bindings.length === 0) return;
  trackChannelMember(ctx.channelMembers, chId, dm.discordUserId);
  for (const b of bindings) {
    await dispatchBindingJoin(ctx, chId, b, dm, gm);
  }
}

/** Route a single binding join to the general-lobby or game-binding handler. */
async function dispatchBindingJoin(
  ctx: JoinHandlerCtx,
  chId: string,
  b: ResolvedBinding,
  dm: DiscordMemberInfo,
  gm?: GuildMember,
): Promise<void> {
  if (b.bindingPurpose === 'general-lobby') {
    await dispatchLobbyJoin(ctx, chId, b, dm, gm);
  } else {
    await handleGameBindingJoin(ctx.deps, chId, b, dm, {
      scheduleSpawn: () =>
        scheduleDelayedSpawn(ctx.deps, chId, b, ctx.timers, SPAWN_DELAY_MS),
      cancelSpawn: () => cancelPendingSpawn(ctx.timers, chId),
    });
  }
}

/** General-lobby join: wire the presence-recheck + spawn callbacks. */
async function dispatchLobbyJoin(
  ctx: JoinHandlerCtx,
  chId: string,
  binding: ResolvedBinding,
  dm: DiscordMemberInfo,
  gm?: GuildMember,
): Promise<void> {
  const fns = {
    scheduleRecheck: () =>
      schedulePresenceRecheck({
        timers: ctx.timers,
        dm,
        channelId: chId,
        guildMember: gm!,
        userChannelMap: ctx.userChannelMap,
        presenceDetector: ctx.presenceDetector,
        handleJoinFn: (ch, d, g) => handleChannelJoin(ctx, ch, d, g),
        logError: (m) => ctx.logger.error(m),
      }),
    scheduleSpawn: () =>
      scheduleDelayedSpawn(ctx.deps, chId, binding, ctx.timers, SPAWN_DELAY_MS),
    cancelSpawn: () => cancelPendingSpawn(ctx.timers, chId),
  };
  await handleGeneralLobbyJoin(ctx.deps, chId, binding, dm, gm, fns);
}
