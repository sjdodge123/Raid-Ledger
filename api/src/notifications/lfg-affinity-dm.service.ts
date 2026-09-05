/**
 * Affinity DMs when an LFG group reaches LFM (ROK-1471 D11).
 *
 * Consent is the EXISTING game subscription — the same recipient read the
 * game-alert fan-out uses — so this adds no new opt-in surface. It fires on
 * `LFM_REACHED` only: `GROUP_CHANGED` is every later shape change and DMing
 * on it would spam a group as it churns.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import { SettingsService } from '../settings/settings.service';
import { getLfgBoardEnabled } from '../settings/settings-lfg-board.helpers';
import { getClientUrl } from '../settings/settings-bot.helpers';
import {
  LFG_EVENTS,
  LFG_EXPIRY_DAYS,
  type LfgLfmReachedPayload,
} from '../lfg/lfg.constants';
import { liveIntent } from '../lfg/lfg-query.helpers';
import { findGameAffinityRecipients } from './game-affinity-recipients.helpers';
import { buildLfgInviteUrl } from './lfg-affinity-dm.helpers';

/** Invites dedup for as long as the intents that triggered them can live. */
const INVITE_DEDUP_TTL_SECONDS = LFG_EXPIRY_DAYS * 24 * 60 * 60;

/** The game columns the DM needs. */
interface InviteGame {
  name: string;
  slug: string;
}

@Injectable()
export class LfgAffinityDmService {
  private readonly logger = new Logger(LfgAffinityDmService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * DM game subscribers once when a group first reaches LFM.
   *
   * NEVER rejects: the emitter is fire-and-forget (`lfg.service.ts` emits
   * without awaiting), so an escaping rejection would be an unhandled
   * rejection at process level rather than a 500 the caller can see.
   *
   * @param payload - The game and its live-intent count at the transition.
   */
  @OnEvent(LFG_EVENTS.LFM_REACHED)
  async handleLfmReached(payload: LfgLfmReachedPayload): Promise<void> {
    try {
      await this.inviteSubscribers(payload);
    } catch (err) {
      this.logger.error(
        `LFG invite wave for game ${payload.gameId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      Sentry.captureException(err, { tags: { context: 'lfg-affinity-dm' } });
    }
  }

  /** The wave itself — every read here may throw; the caller contains it. */
  private async inviteSubscribers(
    payload: LfgLfmReachedPayload,
  ): Promise<void> {
    if (!(await getLfgBoardEnabled(this.settingsService))) return;
    const game = await this.loadGame(payload.gameId);
    if (!game) return;
    const recipients = await this.resolveRecipients(payload.gameId);
    if (recipients.length === 0) {
      this.logger.debug(
        `No LFG invite recipients for game ${payload.gameId}, skipping`,
      );
      return;
    }
    const invitees = await this.claimInvitees(payload.gameId, recipients);
    if (invitees.length === 0) return;
    await this.dispatchInvites(payload, game, invitees);
  }

  /** Read the game the group formed around. */
  private async loadGame(gameId: number): Promise<InviteGame | null> {
    const [game] = await this.db
      .select({ name: schema.games.name, slug: schema.games.slug })
      .from(schema.games)
      .where(eq(schema.games.id, gameId))
      .limit(1);
    return game ?? null;
  }

  /** Subscribers of the game, minus anyone already holding a live intent. */
  private async resolveRecipients(gameId: number): Promise<number[]> {
    const subscriberIds = await findGameAffinityRecipients(this.db, gameId, {
      excludeBanned: true,
    });
    if (subscriberIds.length === 0) return subscriberIds;
    const holders = await this.findLiveIntentHolders(gameId);
    return subscriberIds.filter((id) => !holders.has(id));
  }

  /** Users already in the group — they do not need an invite to it. */
  private async findLiveIntentHolders(gameId: number): Promise<Set<number>> {
    const rows = await this.db
      .select({ userId: schema.lfgIntents.userId })
      .from(schema.lfgIntents)
      .innerJoin(schema.users, eq(schema.users.id, schema.lfgIntents.userId))
      .where(and(eq(schema.lfgIntents.gameId, gameId), liveIntent(new Date())));
    return new Set(rows.map((r) => r.userId));
  }

  /**
   * Claim each recipient through the dedup guard — once per (game, user).
   *
   * Fails CLOSED (E14): if the guard is unreachable we cannot tell an invite
   * from a re-invite, so the whole wave is dropped rather than fanned out
   * uncapped.
   */
  private async claimInvitees(
    gameId: number,
    recipientIds: number[],
  ): Promise<number[]> {
    const invitees: number[] = [];
    for (const userId of recipientIds) {
      try {
        const alreadySent = await this.dedupService.checkAndMarkSent(
          `lfg-invite:game:${gameId}:user:${userId}`,
          INVITE_DEDUP_TTL_SECONDS,
        );
        if (!alreadySent) invitees.push(userId);
      } catch (err) {
        this.logger.error(
          `LFG invite dedup unavailable for game ${gameId} — dropping the wave`,
          err instanceof Error ? err.stack : String(err),
        );
        return [];
      }
    }
    return invitees;
  }

  /** The notification body every invitee in the wave receives. */
  private buildInviteBody(
    payload: LfgLfmReachedPayload,
    game: InviteGame,
    url: string | null,
  ): {
    type: 'lfg_invite';
    title: string;
    message: string;
    payload: Record<string, unknown>;
  } {
    return {
      type: 'lfg_invite',
      title: `${game.name} — ${payload.activeCount} looking to play`,
      message: url
        ? `Join the group: ${url}`
        : 'Join the group on the LFG board.',
      payload: {
        gameId: payload.gameId,
        gameSlug: game.slug,
        gameName: game.name,
        memberCount: payload.activeCount,
        ...(url ? { url } : {}),
      },
    };
  }

  /** Create one `lfg_invite` notification per invitee. */
  private async dispatchInvites(
    payload: LfgLfmReachedPayload,
    game: InviteGame,
    userIds: number[],
  ): Promise<void> {
    const url = buildLfgInviteUrl(
      await getClientUrl(this.settingsService),
      game.slug,
    );
    const body = this.buildInviteBody(payload, game, url);
    const results = await Promise.allSettled(
      userIds.map((userId) =>
        this.notificationService.create({ userId, ...body }),
      ),
    );
    const failed = userIds.filter((_, i) => results[i].status === 'rejected');
    this.logger.log(
      `LFG invites for game ${payload.gameId}: ${results.length - failed.length} sent, ${failed.length} failed`,
    );
    await this.releaseFailedClaims(payload.gameId, failed);
  }

  /**
   * Un-claim the dedup keys of DMs that never went out.
   *
   * The key is claimed BEFORE dispatch so a concurrent wave cannot double-send.
   * A rejected create would otherwise mark the user invited for the full intent
   * lifetime without a DM ever reaching them, so the claim is given back and
   * the next `LFM_REACHED` retries.
   */
  private async releaseFailedClaims(
    gameId: number,
    failedUserIds: number[],
  ): Promise<void> {
    if (failedUserIds.length === 0) return;
    this.logger.warn(
      `LFG invite DM failed for game ${gameId}, users ` +
        `[${failedUserIds.join(', ')}] — releasing their dedup claims to retry`,
    );
    await Promise.allSettled(
      failedUserIds.map((userId) =>
        this.dedupService.releaseKey(
          `lfg-invite:game:${gameId}:user:${userId}`,
        ),
      ),
    );
  }
}
