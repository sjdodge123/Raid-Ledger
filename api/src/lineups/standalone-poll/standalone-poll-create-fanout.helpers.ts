/**
 * Create-time notification fan-out for standalone polls, gated by visibility
 * (ROK-1750 §3). Extracted from `StandalonePollService` to keep it under the
 * 300-line cap.
 *
 * A PRIVATE poll is never broadcast to game-interested users and never posted
 * to a Discord channel — only the members the creator picked get the poll DM.
 * The poll card is the only channel-posting path a standalone poll has at
 * create time (nudge / rally DM match members; the expiry sweep only edits an
 * existing card, and a private poll never gets one). A hub-tagged poll
 * (ROK-1893 P3) is held to the same quiet fan-out until P2b gives it the
 * hub's own channel.
 */
import type { StandalonePollVisibility } from '@raid-ledger/contract';
import type { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import type { StandalonePollNotificationService } from './standalone-poll-notification.service';
import type { CreatePollInput, PollGame } from './standalone-poll.service';
import { resolveCreateFanout } from './standalone-poll-share.helpers';
import { GameActivityNudge } from '../../discord-bot/channel-lifecycle/channel-lifecycle.nudge';

/** No-op rejection swallower for fire-and-forget DMs. */
const noop = (): void => {};

export interface CreateFanoutDeps {
  notifications: Pick<
    StandalonePollNotificationService,
    'notifyInterestedUsers' | 'notifyPickedMembers' | 'notifyRosterReschedule'
  >;
  pollEmbed: Pick<SchedulingPollEmbedService, 'firePostInitialEmbed'>;
  /** ROK-1431: channel-lifecycle activity nudge (absent in narrow test graphs). */
  nudge?: Pick<GameActivityNudge, 'touch'> | undefined;
}

type FanoutIds = { lineupId: number; matchId: number; creatorId: number };

/** Fire-and-forget: the create-time DMs + channel card a poll may send. */
export function fireCreateFanout(
  deps: CreateFanoutDeps,
  game: PollGame,
  ids: FanoutIds,
  input: CreatePollInput,
  pickedIds: number[],
  visibility: StandalonePollVisibility,
  hubId: number | null = null,
): void {
  GameActivityNudge.safeTouch(deps.nudge, game.id);
  // ROK-1893 P3 ruling 2026-10-23: a hub poll stays on its hub (see resolver).
  const fanout = resolveCreateFanout(
    visibility,
    hubId !== null,
    input.linkedEventId !== undefined,
  );
  if (fanout.interestBroadcast) fireInterestBroadcast(deps, game, ids, input);
  if (fanout.pickedMembersDm) {
    const roster = fanout.rosterRescheduleDm ? input.linkedEventId : undefined;
    fireQuietDms(deps, game, ids, pickedIds, roster);
  }
  if (fanout.channelEmbed) {
    deps.pollEmbed.firePostInitialEmbed(
      { id: ids.matchId, gameId: game.id },
      ids.lineupId,
      game.id,
    );
  }
}

/** The generic game-interest broadcast (its roster split included). */
function fireInterestBroadcast(
  deps: CreateFanoutDeps,
  game: PollGame,
  ids: FanoutIds,
  input: CreatePollInput,
): void {
  void deps.notifications
    .notifyInterestedUsers(
      game.id,
      game.name,
      ids.lineupId,
      ids.matchId,
      ids.creatorId,
      game.coverUrl,
      input.linkedEventId,
      input.broadcastExcludeUserIds,
    )
    .catch(noop);
}

/**
 * The quiet fan-out: on a hub-tagged reschedule poll the event roster's
 * reschedule DM first, then the picked members not already told by it.
 */
function fireQuietDms(
  deps: CreateFanoutDeps,
  game: PollGame,
  ids: FanoutIds,
  pickedIds: number[],
  rosterEventId: number | undefined,
): void {
  const told =
    rosterEventId === undefined
      ? Promise.resolve<number[]>([])
      : deps.notifications.notifyRosterReschedule(game, ids, rosterEventId);
  void told
    .then((toldIds) =>
      deps.notifications.notifyPickedMembers(
        pickedIds.filter((id) => !toldIds.includes(id)),
        game.name,
        ids,
        game.coverUrl,
      ),
    )
    .catch(noop);
}
