/**
 * ROK-1541 — every member of an LFG group is a member of the group's forum
 * thread, so the post shows under the board channel in their Discord sidebar.
 *
 * WHEN it acts is the whole design:
 *
 *  - **The post** (`THREAD_MIRROR_EVENTS.BOUND`, emitted once per new forum
 *    thread — first post, deleted-post heal, board re-enable, offline
 *    reconcile): add the WHOLE live roster. This is also AC4's "group revived".
 *  - **A membership change** (`HAND_RAISED` / `LFM_REACHED` / `GROUP_CHANGED`
 *    `joined` | `withdrawn`): move ONLY the users the event names.
 *
 * It never acts on a re-render. `LfgBoardService.editThread` / `flushAll` and
 * the reconnect reconcile are not subscribed to here, and no change re-adds
 * "the roster" — so a member who leaves the thread by hand stays out until
 * they themselves re-join the group (AC3).
 *
 * Every entry point warns and swallows: these run in `POST /lfg`'s emitter.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { SettingsService } from '../../settings/settings.service';
import { getLfgBoardEnabled } from '../../settings/settings-lfg-board.helpers';
import {
  LFG_EVENTS,
  type LfgGroupChangedPayload,
  type LfgGroupChangedReason,
  type LfgLfmReachedPayload,
} from '../../lfg/lfg.constants';
import type { LfgDb } from '../../lfg/lfg-query.helpers';
import { DiscordBotClientService } from '../discord-bot-client.service';
import {
  THREAD_MIRROR_EVENTS,
  type ThreadBoundPayload,
} from '../thread-mirror/thread-mirror.constants';
import { findOpenLfmMessage } from '../lfm/lfm-embed.db-helpers';
import { LfgGameChainService } from './lfg-game-chain.service';
import { describeError } from './lfg-board-retire.helpers';
import {
  applyThreadMembers,
  linkedDiscordIds,
  planMembershipChange,
  type ThreadMemberOp,
} from './lfg-board-thread-members.helpers';
import {
  loadDiscordIds,
  readRosterUserIds,
} from './lfg-board-thread-members.db-helpers';

@Injectable()
export class LfgBoardThreadMembersService {
  private readonly logger = new Logger(LfgBoardThreadMembersService.name);

  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: LfgDb,
    private readonly clientService: DiscordBotClientService,
    private readonly settingsService: SettingsService,
    private readonly chain: LfgGameChainService,
  ) {}

  /**
   * A new forum post for a group: add its whole live roster.
   *
   * Queued on the game's chain like every membership change, and the roster is
   * read when the work RUNS: a withdraw queued ahead of it is already out of
   * the roster, and one queued behind it removes after the add — a stale
   * roster batch can never re-add someone who just left (Codex P2). The mirror
   * emits without awaiting, so queuing from inside a chained post cannot wait
   * on itself.
   *
   * @param payload - The mirror's bound event; only `lfg-group` is ours.
   */
  @OnEvent(THREAD_MIRROR_EVENTS.BOUND)
  onThreadBound(payload: ThreadBoundPayload): Promise<void> {
    if (payload.surfaceKind !== 'lfg-group') return Promise.resolve();
    const gameId = Number(payload.surfaceId);
    return this.chain.serialized(gameId, () =>
      this.guarded(`add group ${gameId}'s roster`, async () => {
        if (!(await getLfgBoardEnabled(this.settingsService))) return;
        const roster = await readRosterUserIds(this.db, gameId);
        await this.apply(payload.threadId, 'add', [...roster]);
      }),
    );
  }

  /** The first hand. Usually the post's own BOUND adds it; this heals a re-fire. */
  @OnEvent(LFG_EVENTS.HAND_RAISED)
  onHandRaised(payload: LfgLfmReachedPayload): Promise<void> {
    return this.onHand(payload);
  }

  /** The hand that completed the pair joins the existing LOOKING post. */
  @OnEvent(LFG_EVENTS.LFM_REACHED)
  onLfmReached(payload: LfgLfmReachedPayload): Promise<void> {
    return this.onHand(payload);
  }

  /** `joined` adds the joiner; `withdrawn` removes the withdrawer. */
  @OnEvent(LFG_EVENTS.GROUP_CHANGED)
  onGroupChanged(payload: LfgGroupChangedPayload): Promise<void> {
    return this.onChange(payload.gameId, payload.reason, payload.userIds ?? []);
  }

  private onHand(payload: LfgLfmReachedPayload): Promise<void> {
    const ids = payload.userId === undefined ? [] : [payload.userId];
    return this.onChange(payload.gameId, 'joined', ids);
  }

  /**
   * Queued on the game's chain, BEHIND `LfmEmbedService`'s post/edit when it
   * was queued first — so a join that creates the post finds its row. When it
   * was queued first instead, no row exists yet and the post's BOUND adds the
   * roster, joiner included. Either order converges.
   */
  private onChange(
    gameId: number,
    reason: LfgGroupChangedReason,
    userIds: readonly number[],
  ): Promise<void> {
    if (reason !== 'joined' && reason !== 'withdrawn') return Promise.resolve();
    if (userIds.length === 0 || !this.clientService.isConnected()) {
      return Promise.resolve();
    }
    return this.chain.serialized(gameId, () =>
      this.guarded(`sync group ${gameId}'s thread members`, async () => {
        const row = await findOpenLfmMessage(this.db, gameId);
        if (row?.postKind !== 'forum') return;
        if (!(await getLfgBoardEnabled(this.settingsService))) return;
        const roster = await readRosterUserIds(this.db, gameId);
        const plan = planMembershipChange(reason, userIds, roster);
        if (!plan) return;
        await this.apply(
          row.threadId ?? row.channelId,
          plan.kind,
          plan.userIds,
        );
      }),
    );
  }

  /** Resolve the thread and apply one batch. Archived posts are left alone. */
  private async apply(
    threadId: string,
    op: ThreadMemberOp,
    userIds: number[],
  ): Promise<void> {
    const ids = linkedDiscordIds(await loadDiscordIds(this.db, userIds));
    const guild = this.clientService.getGuild();
    if (ids.length === 0 || !guild) return;
    const channel = await guild.channels.fetch(threadId);
    if (!channel?.isThread() || channel.archived) return;
    await applyThreadMembers(channel, op, ids, (message) =>
      this.logger.warn(message),
    );
  }

  /** Run one unit of work; a throw becomes a single warning. */
  private async guarded(
    action: string,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (err) {
      this.logger.warn(`Could not ${action}: ${describeError(err)}.`);
    }
  }
}
