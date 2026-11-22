/**
 * ROK-2295 lane B — ONE render path for the scheduling poll embed. The
 * channel card (`SchedulingPollEmbedService`) and the poll's forum-post
 * starter (hub `EventPostOutbound.send`, non-hub `ensurePollPost`, and the
 * in-place edit through `POLL_FORUM_STARTER_PORT`) all render here, so the
 * two surfaces cannot drift. Embed only, no components (Lead decision: the
 * channel card has none; the vote CTA is a masked link in the body).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { EmbedBuilder } from 'discord.js';
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  DiscordEmbedFactory,
  type EmbedContext,
} from '../../discord-bot/services/discord-embed.factory';
import type { ForumStarterCard } from '../../discord-bot/services/event-embed-message.editor';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { SettingsService } from '../../settings/settings.service';
import { pollStatusFromMatch } from './scheduling-poll-embed.helpers';
import {
  loadEmbedData,
  loadLineupLifecycle,
  loadLockedInTime,
  type EmbedDataInput,
} from './scheduling-poll-embed-data.helpers';
import { findScheduleSlots } from './scheduling-query.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type MatchRow = typeof schema.communityLineupMatches.$inferSelect;

/** The forum starter for a rendered poll embed (content `''`, no buttons). */
export function pollStarterCard(embed: EmbedBuilder): ForumStarterCard {
  return { embeds: [embed], components: [] };
}

@Injectable()
export class SchedulingPollForumCard {
  constructor(
    @Inject(DrizzleAsyncProvider) private readonly db: Db,
    private readonly embedFactory: DiscordEmbedFactory,
    private readonly settings: SettingsService,
  ) {}

  /** The poll's starter card; null once the match or its game is gone. */
  async build(matchId: number): Promise<ForumStarterCard | null> {
    const [match] = await this.db
      .select()
      .from(schema.communityLineupMatches)
      .where(eq(schema.communityLineupMatches.id, matchId))
      .limit(1);
    const embed = match ? await this.renderMatch(match) : null;
    return embed ? pollStarterCard(embed) : null;
  }

  /**
   * Lifecycle-aware embed for an existing poll.
   *
   * ROK-1461: the match row carries the lifecycle the embed renders.
   * ROK-1545 (review F2): the page reads the parent lineup's status +
   * deadline, so the embed must too — ONE helper, the same inputs, one answer.
   */
  async renderMatch(match: MatchRow): Promise<EmbedBuilder | null> {
    const [lineup, slots] = await Promise.all([
      loadLineupLifecycle(this.db, match.lineupId),
      findScheduleSlots(this.db, match.id),
    ]);
    const status = pollStatusFromMatch({
      matchStatus: match.status,
      lineupStatus: lineup?.status ?? null,
      phaseDeadline: lineup?.phaseDeadline ?? null,
      linkedEventId: match.linkedEventId,
      // ROK-1607: a card whose every time has passed is not open, however
      // much of the deadline is left.
      slotTimes: slots.map((s) => s.proposedTime),
    });
    return this.render({
      matchId: match.id,
      lineupId: match.lineupId,
      gameId: match.gameId,
      status,
      lockedInTime: await loadLockedInTime(
        this.db,
        match.linkedEventId,
        status,
      ),
      deadline: lineup?.phaseDeadline?.toISOString() ?? null,
      cancelReason: match.cancellationReason ?? null,
    });
  }

  /** The embed for `input`; null when there is nothing to render. */
  async render(
    input: Omit<EmbedDataInput, 'clientUrl'>,
  ): Promise<EmbedBuilder | null> {
    const clientUrl = await this.settings.getClientUrl();
    const data = await loadEmbedData(this.db, { ...input, clientUrl });
    if (!data) return null;
    const context = await this.context();
    return this.embedFactory.buildSchedulingPollEmbed(data, context).embed;
  }

  /**
   * Shared embed context from settings (ROK-1461, operator walk 2026-09-02).
   * Mirrors `embed-sync.processor.ts::buildContext` — same branding source
   * as the lineup card, so the two families cannot drift apart again.
   */
  private async context(): Promise<EmbedContext> {
    const [branding, clientUrl, timezone] = await Promise.all([
      this.settings.getBranding(),
      this.settings.getClientUrl(),
      this.settings.getDefaultTimezone(),
    ]);
    return { communityName: branding.communityName, clientUrl, timezone };
  }
}
