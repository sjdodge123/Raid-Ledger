/**
 * ROK-1445 — general-lobby group resolution.
 *
 * `minPlayers` used to be enforced as a CHANNEL-OCCUPANCY gate while the event
 * roster is a GAME GROUP. Those two sets only coincide when everyone in voice
 * plays the same thing, so a 5-person #general with 1 person on CoD4 minted a
 * 1-player CoD4 event. Everything in this module exists to make the threshold
 * apply to the group that will actually populate the roster:
 *
 * - bots are filtered from counts AND rosters (AC9);
 * - presence-null members are excluded entirely unless `allowJustChatting` is
 *   on, in which case they form their OWN group under the same threshold
 *   (AC7/AC8) — they are never folded into a game group;
 * - groups are partitioned into `qualifying` (>= minPlayers) and `dropped`.
 *   Dropped groups mint nothing (AC5) but still keep their game-activity
 *   tracking (AC6) and emit a `group-below-threshold` trace (AC10).
 *
 * Scope: general-lobby ONLY. Game-specific (`game-voice-monitor`) bindings keep
 * `getGameFilteredCount`'s ROK-697 null-counting — that channel declares a game
 * to assume toward (AC12).
 */
import type { GuildMember, VoiceBasedChannel } from 'discord.js';
import {
  resolveVoiceChannel,
  type ResolvedBinding,
} from './voice-state.helpers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import { gateCtx, traceGate } from './voice-gate-trace';

/** A detected game group inside a general-lobby channel. */
export interface LobbyGameGroup {
  gameId: number | null;
  gameName: string;
  memberIds: string[];
}

/** Groups split by whether they clear the binding's `minPlayers`. */
export interface LobbyGroupPartition {
  /** Groups that clear `minPlayers` — each mints its own event (AC2). */
  qualifying: LobbyGameGroup[];
  /** Groups below `minPlayers` — dropped, never folded elsewhere (AC5). */
  dropped: LobbyGameGroup[];
  minPlayers: number;
  /** Non-bot members currently in the channel (for the gate trace). */
  channelMemberCount: number;
}

/** Whether a guild member is a Discord bot (AC9 — counts and rosters). */
export function isBotMember(
  member: { user?: { bot?: boolean } | null } | null | undefined,
): boolean {
  return member?.user?.bot === true;
}

/** Non-bot members currently connected to a voice channel (AC9). */
export function humanMembers(channel: VoiceBasedChannel): GuildMember[] {
  return [...channel.members.values()].filter((m) => !isBotMember(m));
}

/**
 * Apply the presence-null policy (AC7/AC8). With `allowJustChatting` the null
 * group survives as its own "Just Chatting" group subject to the same
 * threshold; without it, nulls are excluded from counts and rosters entirely.
 */
function applyNullPolicy(
  groups: LobbyGameGroup[],
  allowJustChatting: boolean,
): LobbyGameGroup[] {
  return allowJustChatting
    ? groups.map((g) =>
        g.gameId === null ? { ...g, gameName: 'Just Chatting' } : g,
      )
    : groups.filter((g) => g.gameId !== null);
}

/**
 * Resolve the detected game groups in a general-lobby channel and partition
 * them on the binding's `minPlayers` (AC1).
 */
export async function resolveLobbyGroups(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
): Promise<LobbyGroupPartition> {
  const minPlayers = binding.config?.minPlayers ?? 2;
  const channel = resolveVoiceChannel(deps.clientService, channelId);
  const members = channel ? humanMembers(channel) : [];
  if (members.length === 0)
    return {
      qualifying: [],
      dropped: [],
      minPlayers,
      channelMemberCount: 0,
    };
  const detected = await deps.presenceDetector.detectGames(members);
  const groups = applyNullPolicy(
    detected,
    binding.config?.allowJustChatting ?? false,
  );
  return {
    qualifying: groups.filter((g) => g.memberIds.length >= minPlayers),
    dropped: groups.filter((g) => g.memberIds.length < minPlayers),
    minPlayers,
    channelMemberCount: members.length,
  };
}

/**
 * How many non-bot members would populate the roster of an event for `gameId`
 * in this lobby. This is the number `minPlayers` must be compared against —
 * never `channelMembers.size` (AC1).
 */
export async function lobbyGroupSize(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  gameId: number | null,
): Promise<number> {
  const { qualifying, dropped } = await resolveLobbyGroups(
    deps,
    channelId,
    binding,
  );
  const group = [...qualifying, ...dropped].find((g) => g.gameId === gameId);
  return group?.memberIds.length ?? 0;
}

/** Emit one `group-below-threshold` trace per dropped group (AC10). */
export function traceDroppedGroups(
  deps: VoiceHandlerDeps,
  channelId: string,
  binding: ResolvedBinding,
  partition: LobbyGroupPartition,
): void {
  for (const group of partition.dropped) {
    traceGate(
      deps.logger,
      'group-below-threshold',
      gateCtx(binding, channelId, {
        gameId: group.gameId,
        members: partition.channelMemberCount,
        minPlayers: partition.minPlayers,
        counted: group.memberIds.length,
      }),
    );
  }
}
