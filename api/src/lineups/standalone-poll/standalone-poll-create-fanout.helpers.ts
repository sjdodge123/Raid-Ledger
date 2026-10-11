/**
 * Create-time notification fan-out for standalone polls, gated by visibility
 * (ROK-1750 §3). Extracted from `StandalonePollService` to keep it under the
 * 300-line cap.
 *
 * A PRIVATE poll is never broadcast to game-interested users and never posted
 * to a Discord channel — only the members the creator picked get the poll DM.
 * The poll card is the only channel-posting path a standalone poll has at
 * create time (nudge / rally DM match members; the expiry sweep only edits an
 * existing card, and a private poll never gets one).
 */
import type { StandalonePollVisibility } from '@raid-ledger/contract';
import type { SchedulingPollEmbedService } from '../scheduling/scheduling-poll-embed.service';
import type { StandalonePollNotificationService } from './standalone-poll-notification.service';
import type { CreatePollInput, PollGame } from './standalone-poll.service';
import { resolveCreateFanout } from './standalone-poll-share.helpers';

/** No-op rejection swallower for fire-and-forget DMs. */
const noop = (): void => {};

export interface CreateFanoutDeps {
  notifications: Pick<
    StandalonePollNotificationService,
    'notifyInterestedUsers' | 'notifyPickedMembers'
  >;
  pollEmbed: Pick<SchedulingPollEmbedService, 'firePostInitialEmbed'>;
}

/** Fire-and-forget: the create-time DMs + channel card a poll may send. */
export function fireCreateFanout(
  deps: CreateFanoutDeps,
  game: PollGame,
  ids: { lineupId: number; matchId: number; creatorId: number },
  input: CreatePollInput,
  pickedIds: number[],
  visibility: StandalonePollVisibility,
): void {
  const fanout = resolveCreateFanout(visibility);
  if (fanout.interestBroadcast) {
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
  if (fanout.pickedMembersDm) {
    void deps.notifications
      .notifyPickedMembers(pickedIds, game.name, ids, game.coverUrl)
      .catch(noop);
  }
  if (fanout.channelEmbed) {
    deps.pollEmbed.firePostInitialEmbed(
      { id: ids.matchId, gameId: game.id },
      ids.lineupId,
      game.id,
    );
  }
}
