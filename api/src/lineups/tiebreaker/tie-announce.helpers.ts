/**
 * ROK-1374 (Lane B) — announce-once + edit-in-place for the tie message (D6/D7).
 *
 * The tie gets ONE Discord message for its whole life: posted when the hold
 * opens on a PUBLIC lineup, then edited in place on every later state change
 * (pick, expiry, a re-detected tie). The precedent is the creation embed's
 * `discordCreatedChannelId` / `discordCreatedMessageId` pair — same shape, same
 * lifecycle — and the reason is that a second post is exactly the announcement
 * spam the embed system was built to remove.
 *
 * Discord is best-effort here. The tie hold on `community_lineups` is the
 * source of truth and the readiness card reads it directly, so every failure
 * below is warned and swallowed: an unbound channel or an offline bot must
 * never propagate into the transition path that recorded the hold (E5).
 */
import { Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import { isUnknownMessageError } from '../../discord-bot/services/embed-poster.helpers';
import {
  postChannelEmbed,
  resolveEmbedCtx,
  type DispatchDeps,
} from '../lineup-notification-dispatch.helpers';
import { resolveLineupVisibility } from '../lineup-notification-routing.helpers';
import {
  buildTieDetectedEmbed,
  type TieEmbedGame,
} from '../lineup-notification-tie-embed.helpers';
import type {
  EmbedContext,
  EmbedWithRow,
} from '../lineup-notification-embed.helpers';
import type { LineupInfo } from '../lineup-notification.service';

const logger = new Logger('TieAnnounce');

/** Everything the detected embed needs that the row does not already carry. */
export interface TieAnnouncePayload {
  tiedGames: ReadonlyArray<TieEmbedGame>;
  rosterSize: number;
}

/** Builder signature shared by the decided / expired re-renders. */
export type TieEmbedBuilder = (ctx: EmbedContext) => EmbedWithRow;

/** The persisted announce target, or null when nothing was ever posted. */
async function readAnnounceTarget(
  db: DispatchDeps['db'],
  lineupId: number,
): Promise<{ channelId: string; messageId: string } | null> {
  const [row] = await db
    .select({
      channelId: schema.communityLineups.tieAnnounceChannelId,
      messageId: schema.communityLineups.tieAnnounceMessageId,
    })
    .from(schema.communityLineups)
    .where(eq(schema.communityLineups.id, lineupId))
    .limit(1);
  if (!row?.channelId || !row.messageId) return null;
  return { channelId: row.channelId, messageId: row.messageId };
}

/** Write (or null out) the announce target columns. */
async function writeAnnounceTarget(
  db: DispatchDeps['db'],
  lineupId: number,
  target: { channelId: string; messageId: string } | null,
): Promise<void> {
  await db
    .update(schema.communityLineups)
    .set({
      tieAnnounceChannelId: target?.channelId ?? null,
      tieAnnounceMessageId: target?.messageId ?? null,
      updatedAt: new Date(),
    })
    .where(eq(schema.communityLineups.id, lineupId));
}

/**
 * Announce the tie, or re-render the message already announced for it.
 *
 * Public lineups only — a private tie is DM-only (E22/AC10), mirroring
 * `lineup-notification-tiebreaker.helpers.ts:92-93`.
 *
 * @param deps - Dispatch deps (db, settings, bot client, dedup).
 * @param lineup - The lineup holding the tie.
 * @param payload - Tied games + roster size for the embed body.
 */
export async function announceTie(
  deps: DispatchDeps,
  lineup: LineupInfo,
  payload: TieAnnouncePayload,
): Promise<void> {
  const visibility = await resolveLineupVisibility(deps.db, lineup);
  if (visibility !== 'public') return;
  const build: TieEmbedBuilder = (ctx) =>
    buildTieDetectedEmbed(ctx, payload.tiedGames, payload.rosterSize);
  if (await readAnnounceTarget(deps.db, lineup.id)) {
    await editTieAnnounce(deps, lineup, build);
    return;
  }
  await postTieAnnounce(deps, lineup, build);
}

/** First post + persist. Every failure is warned, never thrown (E5). */
async function postTieAnnounce(
  deps: DispatchDeps,
  lineup: LineupInfo,
  build: TieEmbedBuilder,
): Promise<void> {
  try {
    const ctx = await resolveEmbedCtx(deps, lineup.id, 'voting');
    const posted = await postChannelEmbed(
      deps,
      `lineup-tie:${lineup.id}`,
      () => build(ctx),
      ctx,
    );
    if (!posted) return;
    await writeAnnounceTarget(deps.db, lineup.id, posted);
  } catch (err) {
    logger.warn(
      `Tie announce failed for lineup ${lineup.id}: ${String(err)}`,
    );
  }
}

/**
 * Re-render the announced message in place.
 *
 * A `10008 Unknown Message` means somebody deleted it: null both columns so
 * the row stops pointing at a corpse, and do NOT repost (E4) — reposting turns
 * a moderator's delete into the spam D7 forbids.
 *
 * @param deps - Dispatch deps.
 * @param lineup - The lineup holding the tie.
 * @param build - Builder for the state the message should now show.
 */
export async function editTieAnnounce(
  deps: DispatchDeps,
  lineup: LineupInfo,
  build: TieEmbedBuilder,
): Promise<void> {
  const target = await readAnnounceTarget(deps.db, lineup.id);
  if (!target) return;
  try {
    const ctx = await resolveEmbedCtx(deps, lineup.id, 'voting');
    await deps.botClient.editEmbed(
      target.channelId,
      target.messageId,
      build(ctx).embed,
    );
  } catch (err) {
    if (isUnknownMessageError(err)) {
      logger.warn(
        `Tie message ${target.messageId} is gone; clearing lineup ${lineup.id}`,
      );
      await writeAnnounceTarget(deps.db, lineup.id, null);
      return;
    }
    logger.warn(`Tie edit failed for lineup ${lineup.id}: ${String(err)}`);
  }
}
