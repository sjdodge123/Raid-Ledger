/**
 * ROK-1933 L2 — the suggested-claim DM (spec Part 3, D5–D9).
 *
 * One scan: every unclaimed character played ≥10 min in a live Quick Play,
 * its likely owners minus anyone who answered Not me, the single top pick
 * (`pickClaimCandidate`), three dedupe keys, then one DM through the
 * existing Discord notification pipeline.
 *
 * The DM goes straight to `DiscordNotificationService.dispatch`, not
 * `NotificationService.create`: the type's in-app default is OFF (Q7), and
 * `create` returns before any Discord dispatch when in-app is off. `dispatch`
 * still applies the per-type Discord opt-out, deactivation and the
 * no-Discord-id skip; a skip or a throw releases the keys (the
 * `lfg-affinity-dm.service.ts` release idiom) so the next scan retries.
 * `dispatch` only QUEUES the DM: a queued DM that finally fails comes back
 * as `notification.discord.failed`, which releases the pair key only.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as Sentry from '@sentry/nestjs';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import { NotificationDedupService } from '../../../../notifications/notification-dedup.service';
import { DiscordNotificationService } from '../../../../notifications/discord-notification.service';
import {
  DISCORD_NOTIFICATION_FAILED,
  type DiscordNotificationFailedEvent,
} from '../../../../notifications/discord-notification.events';
import { SettingsService } from '../../../../settings/settings.service';
import { getClientUrl } from '../../../../settings/settings-bot.helpers';
import {
  CLAIM_SUGGEST_MIN_AGE_MS,
  findClaimCandidates,
  findDiscordOptedOut,
  findUnclaimedSightings,
  type ClaimSighting,
} from './valheim-claim-suggest.queries';
import {
  nameStrength,
  pickClaimCandidate,
  type ClaimCandidate,
} from './valheim-claim-suggest.helpers';
import {
  CLAIM_SUGGEST_THROTTLE_TTL_SECONDS,
  buildClaimHubUrl,
  buildClaimSuggestText,
  claimSuggestKeys,
} from './valheim-claim-suggest.copy';

/** The notification type the DM is sent (and opted out) under. */
export const CLAIM_SUGGEST_TYPE = 'valheim_claim_suggestion' as const;

@Injectable()
export class ValheimClaimSuggestService {
  private readonly logger = new Logger(ValheimClaimSuggestService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly dedup: NotificationDedupService,
    private readonly discord: DiscordNotificationService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Run one scan. Per-sighting failures are contained, so one bad row
   * cannot starve the rest.
   *
   * @param now - The scan's clock (tests pin it).
   * @returns How many DMs were dispatched.
   */
  async scan(now: Date = new Date()): Promise<number> {
    const sightings = await findUnclaimedSightings(
      this.db,
      now,
      CLAIM_SUGGEST_MIN_AGE_MS,
    );
    if (sightings.length === 0) return 0;
    const clientUrl = await getClientUrl(this.settings);
    let sent = 0;
    for (const s of sightings) {
      if (await this.trySuggest(s, now, clientUrl)) sent += 1;
    }
    return sent;
  }

  /** `suggest`, with its failure logged instead of thrown. */
  private async trySuggest(
    s: ClaimSighting,
    now: Date,
    clientUrl: string,
  ): Promise<boolean> {
    try {
      return await this.suggest(s, now, clientUrl);
    } catch (err) {
      this.logger.error(
        `Claim suggestion for profile ${s.profileId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      Sentry.captureException(err, { tags: { context: 'valheim-claim-dm' } });
      return false;
    }
  }

  /** Pick, claim the keys, send; release the keys if the send did not go. */
  private async suggest(
    s: ClaimSighting,
    now: Date,
    clientUrl: string,
  ): Promise<boolean> {
    const candidate = await this.pickCandidate(s, now);
    if (!candidate) return false;
    const keys = await this.claimKeys(s.profileId, candidate.userId);
    if (!keys) return false;
    let sent = false;
    try {
      sent = await this.send(s, candidate, clientUrl);
    } finally {
      if (!sent) await this.releaseKeys(keys);
    }
    return sent;
  }

  /**
   * The single top candidate, Not-me and opted-out users removed BEFORE the
   * pick — so neither shadows the next candidate or churns the keys per tick.
   */
  private async pickCandidate(
    s: ClaimSighting,
    now: Date,
  ): Promise<ClaimCandidate | null> {
    const all = await findClaimCandidates(this.db, s, now);
    const optedOut = await findDiscordOptedOut(
      this.db,
      all.map((c) => c.userId),
      CLAIM_SUGGEST_TYPE,
    );
    const declined = await Promise.all(
      all.map((c) =>
        this.dedup.isMarked(claimSuggestKeys.declined(s.profileId, c.userId)),
      ),
    );
    const open = all.filter(
      (c, i) => declined[i] !== true && !optedOut.has(c.userId),
    );
    const userId = pickClaimCandidate(s, open);
    return open.find((c) => c.userId === userId) ?? null;
  }

  /**
   * Claim the per-character, per-user and per-pair keys, in that order.
   *
   * @returns The claimed keys, or null when any is already held (the keys
   *   this call took are given back, so a held per-user key never burns
   *   the character's 24h slot).
   */
  private async claimKeys(
    profileId: number,
    userId: number,
  ): Promise<string[] | null> {
    const pair = claimSuggestKeys.pair(profileId, userId);
    if (await this.dedup.isMarked(pair)) return null;
    const plan: Array<[string, number | null]> = [
      [claimSuggestKeys.profile(profileId), CLAIM_SUGGEST_THROTTLE_TTL_SECONDS],
      [claimSuggestKeys.user(userId), CLAIM_SUGGEST_THROTTLE_TTL_SECONDS],
      [pair, null],
    ];
    const taken: string[] = [];
    try {
      for (const [key, ttl] of plan) {
        if (await this.dedup.checkAndMarkSent(key, ttl)) {
          await this.releaseKeys(taken);
          return null;
        }
        taken.push(key);
      }
    } catch (err) {
      await this.releaseKeys(taken);
      throw err;
    }
    return taken;
  }

  /**
   * A queued claim DM was finally not delivered (retries spent, DMs closed,
   * user gone): give back ONLY its permanent pair key, so the pair may be
   * asked again once the 24h user and profile keys lapse. Releasing those
   * too would re-ask a closed-DM user every scan and trip the 3-strike rule
   * that switches off all their DMs. The declined key is the user's answer
   * and stays. Never throws — a listener failure must not reach the queue
   * processor.
   */
  @OnEvent(DISCORD_NOTIFICATION_FAILED)
  async onDeliveryFailed(event: DiscordNotificationFailedEvent): Promise<void> {
    if (event.type !== CLAIM_SUGGEST_TYPE) return;
    const profileId = event.payload?.['profileId'];
    if (typeof profileId !== 'number') return;
    try {
      await this.dedup.releaseKey(
        claimSuggestKeys.pair(profileId, event.userId),
      );
    } catch (err) {
      this.logger.warn(
        `Releasing claim keys for profile ${profileId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Give back keys whose DM never went out. */
  private async releaseKeys(keys: string[]): Promise<void> {
    await Promise.allSettled(keys.map((k) => this.dedup.releaseKey(k)));
  }

  /** Dispatch the DM; false when the pipeline skipped it. */
  private async send(
    s: ClaimSighting,
    c: ClaimCandidate,
    clientUrl: string,
  ): Promise<boolean> {
    const text = buildClaimSuggestText({
      characterName: s.characterName,
      hubName: await this.loadHubName(s.guildId),
      nameMatched: c.names.some(
        (n) => nameStrength(s.characterName, n) !== 'none',
      ),
      inVoice: c.inVoice,
    });
    return this.discord.dispatch({
      notificationId: `vclaim-${s.profileId}-${c.userId}`,
      userId: c.userId,
      type: CLAIM_SUGGEST_TYPE,
      ...text,
      payload: {
        profileId: s.profileId,
        guildId: s.guildId,
        characterName: s.characterName,
        hubUrl: buildClaimHubUrl(clientUrl, s.guildId),
      },
    });
  }

  /** The server hub's display name for the copy. */
  private async loadHubName(guildId: number): Promise<string> {
    const [row] = await this.db
      .select({ name: schema.guilds.name })
      .from(schema.guilds)
      .where(eq(schema.guilds.id, guildId))
      .limit(1);
    return row?.name ?? 'the server';
  }
}
