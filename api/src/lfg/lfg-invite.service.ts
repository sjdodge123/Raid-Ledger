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
import type {
  LfgInviteResponseDto,
  LfgSuggestionReason,
} from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from '../notifications/notification.service';
import type { CreateNotificationInput } from '../notifications/notification.types';
import { buildLfgInviteUrl } from '../notifications/lfg-affinity-dm.helpers';
import { SettingsService } from '../settings/settings.service';
import { getClientUrl } from '../settings/settings-bot.helpers';
import { requireGame, type LfgDb } from './lfg-query.helpers';
import { listSuggestions } from './lfg-suggestions.helpers';
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

/** `notifications.payload` for `lfg_player_invite` — what the DM builder reads. */
export interface LfgPlayerInvitePayload {
  gameId: number;
  gameSlug: string;
  gameName: string;
  inviterUserId: number;
  /** Display name, falling back to username — the `✉ Invited by …` line. */
  inviterName: string;
  /** Why the recipient was suggested (`played` → `owns` → `hearted`). */
  reasons: LfgSuggestionReason[];
  /** Masked link to the group page; absent when no client URL is configured. */
  url?: string;
  /** Steam lifetime playtime in MINUTES (`steam_library` row); absent when unknown (AC6). */
  playtimeMinutes?: number;
}

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

/** AC3: the one HONEST refusal — the group's own budget, as a 429 (D13). */
async function assertGroupCapNotSpent(
  tx: LfgDb,
  gameId: number,
  now: Date,
): Promise<void> {
  const sent = await countGroupInvitesSince(tx, gameId, groupWindowStart(now));
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
  recipientUserId: number,
  gameId: number,
  now: Date,
): Promise<LfgInviteRefusal | null> {
  if (!(await recipientIsEligible(tx, recipientUserId))) return 'ineligible';
  if (!(await recipientHasLinkedDiscord(tx, recipientUserId)))
    return 'unlinked';
  if (await recipientOptedOut(tx, recipientUserId)) return 'opted_out';
  if (await holdsLiveIntent(tx, recipientUserId, gameId, now))
    return 'in_group';
  const live = await findLiveInviteFor(
    tx,
    recipientUserId,
    gameId,
    noRepeatHorizonStart(now),
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
  ) {}

  /**
   * `POST /lfg/:gameId/invites` (D6). One recipient per call.
   *
   * @param inviterUserId - The caller; must hold a live intent on the game.
   * @param gameId - The group.
   * @param recipientUserId - Who to invite.
   * @param now - Injected clock so the windows are testable without timers.
   * @throws 400 self-invite · 403 not in the group · 404 game · 429 group cap.
   */
  async invite(
    inviterUserId: number,
    gameId: number,
    recipientUserId: number,
    now: Date = new Date(),
  ): Promise<LfgInviteResponseDto> {
    if (inviterUserId === recipientUserId) {
      throw new BadRequestException('You cannot invite yourself');
    }
    const game = await requireGame(this.db, gameId);
    if (!(await holdsLiveIntent(this.db, inviterUserId, gameId, now))) {
      throw new ForbiddenException('Only members of this group can invite');
    }
    const body = await this.buildNotification(
      game,
      inviterUserId,
      recipientUserId,
    );
    return this.db.transaction((tx) =>
      this.sendUnderLocks(
        tx,
        { inviterUserId, recipientUserId, gameId },
        body,
        now,
      ),
    );
  }

  /** D4/D5: lock → group cap → recipient checks → insert → create, as ONE unit. */
  private async sendUnderLocks(
    tx: LfgDb,
    ids: { inviterUserId: number; recipientUserId: number; gameId: number },
    body: Omit<CreateNotificationInput, 'userId'>,
    now: Date,
  ): Promise<LfgInviteResponseDto> {
    const { inviterUserId, recipientUserId, gameId } = ids;
    await takeInviteLocks(tx, recipientUserId, gameId);
    await assertGroupCapNotSpent(tx, gameId, now);
    const refusal = await findRecipientRefusal(
      tx,
      recipientUserId,
      gameId,
      now,
    );
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
    await insertInvite(tx, { recipientUserId, inviterUserId, gameId });
    // Inside the transaction on purpose (A4): a throw here rolls the row
    // back, so a DM that never left never spends the budget.
    await this.notifications.create({ userId: recipientUserId, ...body });
    return LFG_INVITE_SENT;
  }

  /**
   * The decline effect (D12): stamp the caller's newest live invite for the
   * game. Idempotent — a second click finds nothing un-declined and is a no-op.
   *
   * @returns True when a row was stamped.
   */
  async decline(
    recipientUserId: number,
    gameId: number,
    now: Date = new Date(),
  ): Promise<boolean> {
    const row = await declineLiveInvite(this.db, recipientUserId, gameId, now);
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

  /** The payload the DM renders from: reasons, link, Steam playtime (AC6/AC7). */
  private async buildPayload(
    game: typeof schema.games.$inferSelect,
    inviterUserId: number,
    inviterName: string,
    recipientUserId: number,
  ): Promise<LfgPlayerInvitePayload> {
    const suggestion = (
      await listSuggestions(this.db, game.id, inviterUserId)
    ).find((s) => s.userId === recipientUserId);
    const url = buildLfgInviteUrl(await getClientUrl(this.settings), game.slug);
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
      reasons: suggestion?.reasons ?? [],
      ...(url ? { url } : {}),
      ...(minutes !== null ? { playtimeMinutes: minutes } : {}),
    };
  }

  /** Title, message and the payload the DM renders from (AC7). */
  private async buildNotification(
    game: typeof schema.games.$inferSelect,
    inviterUserId: number,
    recipientUserId: number,
  ): Promise<Omit<CreateNotificationInput, 'userId'>> {
    const inviterName = await this.resolveInviterName(inviterUserId);
    const payload = await this.buildPayload(
      game,
      inviterUserId,
      inviterName,
      recipientUserId,
    );
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
