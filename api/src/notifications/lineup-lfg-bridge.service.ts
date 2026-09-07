/**
 * Lineup → LFG bridge (ROK-1457): when a lineup reaches `decided`, OFFER LFG
 * to the nominators of the games that did not win.
 *
 * Offers, never seeds. This service writes exactly two things — a
 * `notification_dedup` claim per (user, game) and ONE `notifications` row per
 * user — and never touches `lfg_intents`. The intent row is written only by
 * the player's own `POST /lfg` (design doc L190: "fire on expressed intent,
 * never inferred intent").
 *
 * Shape mirrors `LfgAffinityDmService`: `@OnEvent` wrapper that never rejects,
 * fail-closed dedup claim BEFORE dispatch, claims released for any user whose
 * notification create rejected.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import * as schema from '../drizzle/schema';
import { NotificationService } from './notification.service';
import { NotificationDedupService } from './notification-dedup.service';
import {
  LINEUP_EVENTS,
  type LineupDecidedPayload,
} from '../lineups/lineup-events.constants';
import {
  LFG_BRIDGE_DEDUP_TTL_SECONDS,
  bridgeDedupKey,
  findBridgeCandidates,
  groupOffersByUser,
  type BridgeBatch,
  type BridgeCandidate,
} from '../lfg/lfg-bridge.helpers';

@Injectable()
export class LineupLfgBridgeService {
  private readonly logger = new Logger(LineupLfgBridgeService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly notificationService: NotificationService,
    private readonly dedupService: NotificationDedupService,
  ) {}

  /**
   * Offer LFG once per (user, game) when a lineup closes.
   *
   * NEVER rejects: `runStatusTransition` emits without awaiting, so an
   * escaping rejection would be a process-level unhandled rejection rather
   * than anything the transition could see.
   *
   * @param payload - The lineup that just reached `decided`.
   */
  @OnEvent(LINEUP_EVENTS.DECIDED)
  async handleLineupDecided(payload: LineupDecidedPayload): Promise<void> {
    try {
      await this.offerLfg(payload.lineupId);
    } catch (err) {
      this.logger.error(
        `LFG bridge for lineup ${payload.lineupId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
      );
      Sentry.captureException(err, {
        tags: { context: 'lineup-lfg-bridge' },
      });
    }
  }

  /** The wave itself — every read here may throw; the caller contains it. */
  private async offerLfg(lineupId: number): Promise<void> {
    const candidates = await findBridgeCandidates(
      this.db,
      lineupId,
      new Date(),
    );
    if (candidates.length === 0) {
      this.logger.debug(
        `No LFG bridge candidates for lineup ${lineupId}, skipping`,
      );
      return;
    }
    const claimed = await this.claimCandidates(lineupId, candidates);
    if (claimed.length === 0) return;
    await this.dispatchOffers(lineupId, groupOffersByUser(claimed));
  }

  /**
   * Claim each (user, game) through the dedup guard; keep the rows whose
   * claim is new. A user whose games were ALL offered within the TTL gets
   * nothing; a user with one new game gets a notification naming only it.
   *
   * Fails CLOSED: if the guard is unreachable we cannot tell an offer from a
   * re-offer, so the whole wave is dropped rather than fanned out uncapped.
   */
  private async claimCandidates(
    lineupId: number,
    candidates: BridgeCandidate[],
  ): Promise<BridgeCandidate[]> {
    const claimed: BridgeCandidate[] = [];
    for (const row of candidates) {
      try {
        const alreadySent = await this.dedupService.checkAndMarkSent(
          bridgeDedupKey(row.userId, row.gameId),
          LFG_BRIDGE_DEDUP_TTL_SECONDS,
        );
        if (!alreadySent) claimed.push(row);
      } catch (err) {
        this.logger.error(
          `LFG bridge dedup unavailable for lineup ${lineupId} — dropping the wave`,
          err instanceof Error ? err.stack : String(err),
        );
        return [];
      }
    }
    return claimed;
  }

  /** One in-app `community_lineup` notification per user — no Discord DM. */
  private async dispatchOffers(
    lineupId: number,
    batches: BridgeBatch[],
  ): Promise<void> {
    const results = await Promise.allSettled(
      batches.map((batch) =>
        this.notificationService.create({
          userId: batch.userId,
          type: 'community_lineup',
          title: batch.title,
          message: batch.message,
          payload: batch.payload,
          skipDiscord: true,
        }),
      ),
    );
    const failed = batches.filter((_, i) => results[i].status === 'rejected');
    this.logger.log(
      `LFG bridge offers for lineup ${lineupId}: ${
        results.length - failed.length
      } sent, ${failed.length} failed`,
    );
    await this.releaseFailedClaims(lineupId, failed);
  }

  /**
   * Un-claim the dedup keys of offers that never went out, so the next close
   * can retry instead of the user being marked offered for the whole TTL.
   */
  private async releaseFailedClaims(
    lineupId: number,
    failed: BridgeBatch[],
  ): Promise<void> {
    if (failed.length === 0) return;
    this.logger.warn(
      `LFG bridge offer failed for lineup ${lineupId}, users ` +
        `[${failed.map((b) => b.userId).join(', ')}] — releasing their claims`,
    );
    await Promise.allSettled(
      failed.flatMap((batch) =>
        batch.gameIds.map((gameId) =>
          this.dedupService.releaseKey(bridgeDedupKey(batch.userId, gameId)),
        ),
      ),
    );
  }
}
