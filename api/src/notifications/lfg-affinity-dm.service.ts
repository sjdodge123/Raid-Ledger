/**
 * Affinity DMs when an LFG group reaches LFM (ROK-1471 D11).
 *
 * Consent is the EXISTING game subscription and nothing else: recipients come
 * from `game_interests` via `interestsOnly`, so a user whose only tie to the
 * game is a signup from months ago is never DM'd. It fires on
 * `LFM_REACHED` only: `GROUP_CHANGED` is every later shape change and DMing
 * on it would spam a group as it churns.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { and, eq, inArray, isNull } from 'drizzle-orm';
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

/**
 * Invites dedup for as long as the intents that triggered them can live.
 *
 * ROK-1479 A12 leaves this at 14 days DELIBERATELY, including for a 30-minute
 * `now` wave: shortening it for now-groups is a notification-policy call that
 * belongs to ROK-1455, and AC8(a) pins the TTL, the key shape, the cap and the
 * `lfg_invite` opt-out as unchanged by this story.
 */
const INVITE_DEDUP_TTL_SECONDS = LFG_EXPIRY_DAYS * 24 * 60 * 60;

/**
 * The horizon a `now` invite quotes when the payload carries no TTL.
 *
 * Reachable only for `urgency: 'now'` with a null `ttlMinutes` — a `now` row
 * whose `ttl_minutes` was never set, which `nowTtlBucket` also treats as 30.
 * A `week` payload never reaches this copy at all.
 */
const DEFAULT_NOW_TTL_MINUTES = 30;

/**
 * ROK-1494 — ad-hoc statuses that mean "the session is still going".
 * `ended` and a cancelled row are past tense: their channel is gone.
 */
const LIVE_AD_HOC_STATUSES = ['live', 'grace_period'];

/** The game columns the DM needs. */
interface InviteGame {
  name: string;
  slug: string;
}

/** The stored notification body every branch of the wave produces. */
interface InviteBody {
  type: 'lfg_invite';
  title: string;
  message: string;
  payload: Record<string, unknown>;
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

  /**
   * ROK-1494 — the live LFG-born session for a game, or null.
   *
   * Provenance, exactly as D2 defines it: an ad-hoc, uncancelled, still-open
   * event that an `lfg_intents` row of this game converted into. Read at
   * dispatch rather than taken off the payload, because `LFM_REACHED` fires
   * BEFORE the spawn transaction commits — a miss here is not an error, it is
   * the ordinary "the channel is not up yet" case, and the copy falls back.
   *
   * @param gameId - Game the wave is for.
   * @returns The event id, or null when nothing is playing.
   */
  private async findLiveSession(gameId: number): Promise<number | null> {
    const [row] = await this.db
      .select({ eventId: schema.events.id })
      .from(schema.events)
      .innerJoin(
        schema.lfgIntents,
        eq(schema.lfgIntents.convertedToEventId, schema.events.id),
      )
      .where(
        and(
          eq(schema.events.gameId, gameId),
          eq(schema.events.isAdHoc, true),
          isNull(schema.events.cancelledAt),
          inArray(schema.events.adHocStatus, LIVE_AD_HOC_STATUSES),
        ),
      )
      .limit(1);
    return row?.eventId ?? null;
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
      interestsOnly: true,
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

  /**
   * The notification body every invitee in the wave receives.
   *
   * ROK-1479 D10 is COPY ONLY: a `now` wave says so and quotes its horizon,
   * a `week` wave is byte-identical to the ROK-1471 strings, and neither
   * branch touches the dedup key, the TTL, the cap or the opt-out type.
   */
  private buildInviteBody(
    payload: LfgLfmReachedPayload,
    game: InviteGame,
    url: string | null,
    sessionEventId: number | null,
  ): InviteBody {
    // ROK-1494 — BOTH conditions: a game can hold a live session while a
    // WEEKLY group forms around it, and those subscribers are not invited to
    // the session, they are invited to their own group.
    if (payload.urgency === 'now' && sessionEventId !== null)
      return this.playingInviteBody(payload, game, url, sessionEventId);
    const nowWave = payload.urgency === 'now';
    return {
      type: 'lfg_invite',
      title: nowWave
        ? `${game.name} — ${payload.activeCount} want to play now`
        : `${game.name} — ${payload.activeCount} looking to play`,
      message: nowWave
        ? this.nowInviteMessage(payload, url)
        : url
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

  /**
   * ROK-1494 — the body for a now-group whose session is already up.
   *
   * The link is the GROUP page, not the voice channel: a DM is read outside
   * Discord as often as in it, and the group page is the one surface that
   * carries both the voice link and the event. `eventId` rides the stored
   * payload so a later DM chrome can deep-link without a second read.
   */
  private playingInviteBody(
    payload: LfgLfmReachedPayload,
    game: InviteGame,
    url: string | null,
    eventId: number,
  ): InviteBody {
    return {
      type: 'lfg_invite',
      title: `${game.name} — playing now`,
      message: url
        ? `The voice channel is open — join: ${url}`
        : 'The voice channel is open — join on the LFG board.',
      payload: {
        gameId: payload.gameId,
        gameSlug: game.slug,
        gameName: game.name,
        memberCount: payload.activeCount,
        eventId,
        ...(url ? { url } : {}),
      },
    };
  }

  /** D10 — the `now` wave's body, quoting the horizon it is good for. */
  private nowInviteMessage(
    payload: LfgLfmReachedPayload,
    url: string | null,
  ): string {
    const ttl = payload.ttlMinutes ?? DEFAULT_NOW_TTL_MINUTES;
    return url
      ? `Playing in the next ${ttl} minutes — join: ${url}`
      : `Playing in the next ${ttl} minutes — join on the LFG board.`;
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
    const body = this.buildInviteBody(
      payload,
      game,
      url,
      await this.findLiveSession(payload.gameId),
    );
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
