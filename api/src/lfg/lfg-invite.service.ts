/**
 * LFG player invites — the restraints (ROK-1455 D4/D5/D9).
 *
 * The send is easy; the restraint is the feature. Every limit is a SQL count
 * over `lfg_invites` evaluated inside ONE transaction that also inserts the
 * row, under two advisory locks taken in a fixed order, so the budgets are
 * exact under concurrency. The DM goes through `NotificationService.create`
 * — the existing dispatch path — INSIDE that transaction, so a throw from it
 * rolls the row back and no budget is spent on a DM that never left (A4).
 *
 * Refusal shape (D13): the group cap is honest (429 + message); every
 * recipient-scoped refusal is the one opaque `skipped / unavailable`, so the
 * Invite button is never an oracle for "muted you" or "declined you".
 */
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  forwardRef,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  LFG_ANY_GROUP_KEY,
  type LfgInviteResponseDto,
} from '@raid-ledger/contract';
import type { LfgPlayerInvitePayload } from './lfg-invite-payload.types';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import type { CreateNotificationInput } from '../notifications/notification.types';
import { buildLfgInviteUrl } from '../notifications/lfg-affinity-dm.helpers';
import { SettingsService } from '../settings/settings.service';
import { getClientUrl } from '../settings/settings-bot.helpers';
import { getLfgNowIndicatorEmoji } from '../settings/settings-lfg-board.helpers';
import { PluginRegistryService } from '../plugins/plugin-host/plugin-registry.service';
import {
  resolveGameReadScope,
  type LfgGroupScope,
} from './lfg-group-scope.helpers';
import {
  readGroupHorizon,
  type LfgGroupHorizon,
} from './lfg-group-horizon.helpers';
import { groupReadPressWouldSpawnNow } from '../discord-bot/lfg-now/lfg-now-indicator.helpers';
import {
  getGroupSummary,
  requireVisibleGame,
  type LfgDb,
} from './lfg-query.helpers';
import { reasonsForUser } from './lfg-suggestions.helpers';
import {
  LFG_INVITE_GROUP_CAP,
  LFG_INVITE_GROUP_CAP_CODE,
  LFG_INVITE_GROUP_CAP_MESSAGE,
  LFG_INVITE_NOTIFICATION_TYPE,
  LFG_INVITE_RECIPIENT_LIMIT,
  LFG_INVITE_SKIP_REASON,
  groupWindowStart,
  lfgInviteGameLockKey,
  lfgInviteRecipientLockKey,
  noRepeatHorizonStart,
  recipientWindowStart,
} from './lfg-invite.constants';
import {
  countGroupInvitesSince,
  countRecipientInvitesSince,
  declineLiveInvite,
  findLiveInviteFor,
  holdsLiveIntent,
  insertInvite,
  recipientHasLinkedDiscord,
  recipientIsEligible,
  recipientOptedOut,
  steamPlaytimeMinutes,
} from './lfg-invite.helpers';

/** `200 { status: 'sent' }`. */
export const LFG_INVITE_SENT: LfgInviteResponseDto = {
  status: 'sent',
  reason: null,
};

/** `200 { status: 'skipped', reason: 'unavailable' }` — the only skip body. */
export const LFG_INVITE_SKIPPED: LfgInviteResponseDto = {
  status: 'skipped',
  reason: LFG_INVITE_SKIP_REASON,
};

/** Why a recipient-scoped invite was refused — logged, NEVER returned (D13). */
export type LfgInviteRefusal =
  | 'ineligible'
  | 'unlinked'
  | 'opted_out'
  | 'in_group'
  | 'repeat'
  | 'recipient_budget';

// Moved to its own module (max-lines); re-exported so importers are unchanged.
export type { LfgPlayerInvitePayload } from './lfg-invite-payload.types';

/** D5: recipient lock FIRST, then game — the order every caller must keep. */
async function takeInviteLocks(
  tx: LfgDb,
  recipientUserId: number,
  gameId: number,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${lfgInviteRecipientLockKey(recipientUserId)}))`,
  );
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${lfgInviteGameLockKey(gameId)}))`,
  );
}

/** The ids one send is about; `scope` is the group (null = the fold). */
interface InviteIds {
  inviterUserId: number;
  recipientUserId: number;
  gameId: number;
  scope: LfgGroupScope;
}

/** AC3: the one HONEST refusal — the group's own budget, as a 429 (D13). */
async function assertGroupCapNotSpent(
  tx: LfgDb,
  ids: InviteIds,
  now: Date,
): Promise<void> {
  const since = groupWindowStart(now);
  const sent = await countGroupInvitesSince(tx, ids.gameId, since, ids.scope);
  if (sent >= LFG_INVITE_GROUP_CAP) {
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message: LFG_INVITE_GROUP_CAP_MESSAGE,
        code: LFG_INVITE_GROUP_CAP_CODE,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** The recipient-scoped checks, cheapest first; the first hit wins. */
async function findRecipientRefusal(
  tx: LfgDb,
  { recipientUserId, gameId, scope }: InviteIds,
  now: Date,
): Promise<LfgInviteRefusal | null> {
  if (!(await recipientIsEligible(tx, recipientUserId))) return 'ineligible';
  if (!(await recipientHasLinkedDiscord(tx, recipientUserId)))
    return 'unlinked';
  if (await recipientOptedOut(tx, recipientUserId)) return 'opted_out';
  if (await holdsLiveIntent(tx, recipientUserId, gameId, now, scope))
    return 'in_group';
  // ROK-2352 (spec Q2): the repeat block is per group — the same person
  // invited to THIS group inside the horizon is refused; another group's
  // invite does not count. The fold (null) keeps the whole-game read.
  const live = await findLiveInviteFor(
    tx,
    recipientUserId,
    gameId,
    noRepeatHorizonStart(now),
    scope,
  );
  if (live) return 'repeat';
  const received = await countRecipientInvitesSince(
    tx,
    recipientUserId,
    recipientWindowStart(now),
  );
  if (received >= LFG_INVITE_RECIPIENT_LIMIT) return 'recipient_budget';
  return null;
}

@Injectable()
export class LfgInviteService {
  private readonly logger = new Logger(LfgInviteService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly settings: SettingsService,
    @Inject(forwardRef(() => NotificationService))
    private readonly notifications: NotificationService,
    private readonly pluginRegistry: PluginRegistryService,
  ) {}

  /**
   * `POST /lfg/:gameId/invites` (D6). One recipient per call.
   *
   * @param inviterUserId - The caller; must hold a live intent on the game.
   * @param gameId - The group.
   * @param recipientUserId - Who to invite.
   * @param group - ROK-2352 `?group`; folded to the whole game without an adapter.
   * @param now - Injected clock so the windows are testable without timers.
   * @throws 400 self-invite · 403 not in the group · 404 game · 429 group cap.
   */
  async invite(
    inviterUserId: number,
    gameId: number,
    recipientUserId: number,
    group?: string,
    now: Date = new Date(),
  ): Promise<LfgInviteResponseDto> {
    if (inviterUserId === recipientUserId) {
      throw new BadRequestException('You cannot invite yourself');
    }
    const game = await requireVisibleGame(this.db, gameId);
    const scope = resolveGameReadScope(this.pluginRegistry, game.slug, group);
    if (!(await holdsLiveIntent(this.db, inviterUserId, gameId, now, scope))) {
      throw new ForbiddenException('Only members of this group can invite');
    }
    const ids: InviteIds = { inviterUserId, recipientUserId, gameId, scope };
    // Send-time horizon snapshot only, for the copy. The Join button re-reads
    // it at PRESS time, so a DM opened later cannot raise a stale hand.
    const horizon = await readGroupHorizon(this.db, gameId, now);
    const body = await this.buildNotification(game, ids, horizon);
    return this.db.transaction((tx) => this.sendUnderLocks(tx, ids, body, now));
  }

  /** D4/D5: lock → group cap → recipient checks → insert → create, as ONE unit. */
  private async sendUnderLocks(
    tx: LfgDb,
    ids: InviteIds,
    body: Omit<CreateNotificationInput, 'userId'>,
    now: Date,
  ): Promise<LfgInviteResponseDto> {
    const { inviterUserId, recipientUserId, gameId } = ids;
    await takeInviteLocks(tx, recipientUserId, gameId);
    await assertGroupCapNotSpent(tx, ids, now);
    const refusal = await findRecipientRefusal(tx, ids, now);
    if (refusal) {
      // `log`, not `debug`: the wire body is deliberately opaque (D13), so this
      // line is the ONLY place the reason exists — and `getLogLevels` drops
      // `debug` unless DEBUG=true / NODE_ENV=development, which is never true
      // in the DEMO container CI runs the smoke against. A refusal that only
      // logs where nobody can read it costs a full diagnosis cycle.
      this.logger.log(
        `Invite ${inviterUserId} → ${recipientUserId} on game ${gameId} skipped: ${refusal}`,
      );
      return LFG_INVITE_SKIPPED;
    }
    const groupKey = ids.scope ?? LFG_ANY_GROUP_KEY;
    await insertInvite(tx, {
      recipientUserId,
      inviterUserId,
      gameId,
      groupKey,
    });
    // Inside the transaction on purpose (A4): a throw here rolls the row
    // back, so a DM that never left never spends the budget.
    await this.notifications.create({ userId: recipientUserId, ...body });
    return LFG_INVITE_SENT;
  }

  /**
   * The decline effect (D12): stamp the caller's newest live invite for the
   * game. Idempotent — a second click finds nothing un-declined and is a no-op.
   *
   * @param groupKey - ROK-2352: the v2 button's group; omitted = newest in the game.
   * @returns True when a row was stamped.
   */
  async decline(
    recipientUserId: number,
    gameId: number,
    now: Date = new Date(),
    groupKey: string | null = null,
  ): Promise<boolean> {
    const row = await declineLiveInvite(
      this.db,
      recipientUserId,
      gameId,
      now,
      groupKey,
    );
    return row !== null;
  }

  /** Display name, then username — the `Invited by` line (AC7). */
  private async resolveInviterName(inviterUserId: number): Promise<string> {
    const [inviter] = await this.db
      .select({
        username: schema.users.username,
        displayName: schema.users.displayName,
      })
      .from(schema.users)
      .where(eq(schema.users.id, inviterUserId))
      .limit(1);
    return inviter?.displayName ?? inviter?.username ?? 'A player';
  }

  /**
   * ROK-1619 AC7: would the recipient's Join form the group? The recipient
   * holds no live hand (`in_group` refuses the send otherwise), so their press
   * is always a NEW hand — `viewerHoldsNowHand` is false.
   *
   * Computed at SEND time, per recipient: simultaneous invites to the same
   * one-short group can each show "starts the group". Only the first press
   * spawns it; the rest attach to that session without error (the spawn guard
   * runs under the group lock), so the extra marks are harmless.
   */
  private async spawnsNowField(
    game: typeof schema.games.$inferSelect,
    { recipientUserId, scope }: InviteIds,
  ): Promise<{ spawnsNow?: true; spawnEmoji?: string }> {
    const group = await getGroupSummary(this.db, game, recipientUserId, scope);
    if (!groupReadPressWouldSpawnNow(group, false)) return {};
    const emoji = await getLfgNowIndicatorEmoji(this.settings);
    return emoji ? { spawnsNow: true, spawnEmoji: emoji } : { spawnsNow: true };
  }

  /** The payload the DM renders from: reasons, link, Steam playtime (AC6/AC7). */
  private async buildPayload(
    game: typeof schema.games.$inferSelect,
    ids: InviteIds,
    inviterName: string,
    horizon: LfgGroupHorizon,
  ): Promise<LfgPlayerInvitePayload> {
    const { inviterUserId, recipientUserId } = ids;
    // The RECIPIENT's own reasons, not a lookup into the ranked, capped
    // suggestion list: that list stops at LFG_SUGGESTIONS_LIMIT, so a
    // recipient outside the cut used to get `reasons: []` (ROK-1455 smoke S1).
    const reasons = await reasonsForUser(this.db, game.id, recipientUserId);
    const groupKey = ids.scope ?? LFG_ANY_GROUP_KEY;
    const url = buildLfgInviteUrl(
      await getClientUrl(this.settings),
      game.slug,
      groupKey,
    );
    const minutes = await steamPlaytimeMinutes(
      this.db,
      recipientUserId,
      game.id,
    );
    return {
      gameId: game.id,
      gameSlug: game.slug,
      gameName: game.name,
      inviterUserId,
      inviterName,
      reasons,
      urgency: horizon.urgency,
      ...(groupKey !== LFG_ANY_GROUP_KEY ? { groupKey } : {}),
      ...(url ? { url } : {}),
      ...(minutes !== null ? { playtimeMinutes: minutes } : {}),
      ...(horizon.nowExpiresAt
        ? { nowExpiresAt: horizon.nowExpiresAt.toISOString() }
        : {}),
      ...(await this.spawnsNowField(game, ids)),
    };
  }

  /** Title, message and the payload the DM renders from (AC7). */
  private async buildNotification(
    game: typeof schema.games.$inferSelect,
    ids: InviteIds,
    horizon: LfgGroupHorizon,
  ): Promise<Omit<CreateNotificationInput, 'userId'>> {
    const inviterName = await this.resolveInviterName(ids.inviterUserId);
    const payload = await this.buildPayload(game, ids, inviterName, horizon);
    return {
      type: LFG_INVITE_NOTIFICATION_TYPE,
      title: `${inviterName} invited you to play ${game.name}`,
      message: payload.url
        ? `Join the group: ${payload.url}`
        : 'Join the group on the LFG board.',
      payload: { ...payload },
    };
  }
}
