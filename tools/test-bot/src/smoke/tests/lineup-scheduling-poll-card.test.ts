/**
 * ROK-1473 — a lineup's own scheduling poll posts its Discord card.
 *
 * Drives a full lineup through nomination → voting → decided. The vote
 * tally puts the single nominated game over the match threshold, which
 * flips its match to `scheduling`; that flip must post ONE poll card into
 * the lineup's channel carrying the `POLL OPEN` author line and the
 * `/community-lineup/:lineupId/schedule/:matchId` masked link.
 *
 * Before ROK-1473 nothing called `firePostInitialEmbed` for a lineup-phase
 * match, so this channel stayed silent and every later re-render was a no-op.
 */
import {
  pollForEmbed,
  snapshotMessageIds,
  waitForEmbedUpdate,
} from '../../helpers/polling.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { SimpleEmbed } from '../../helpers/messages.js';
import type { ApiClient } from '../api.js';
import { archiveOwnLeftoverLineups } from '../lineup-leftovers.js';

interface LineupPayload {
  id: number;
  [k: string]: unknown;
}

export interface MatchPayload {
  id: number;
  [k: string]: unknown;
}

/** ROK-1461 author line for an open scheduling poll. */
export const POLL_OPEN = 'POLL OPEN';

/**
 * Resolve the channel the poll card routes to.
 *
 * The card follows the LINEUP chain (per-lineup override → admin lineup
 * channel → default announcement channel), so polling `defaultChannelId`
 * blindly times out on an environment that configured a lineup channel.
 */
export async function resolveLineupChannelId(
  api: ApiClient,
  fallback: string,
): Promise<string> {
  const res = await api
    .get<{ channelId: string | null }>(
      '/admin/settings/discord-bot/lineup-channel',
    )
    .catch(() => null);
  return res?.channelId ?? fallback;
}

/**
 * Title prefixes of the lineups this file creates. Each title is exactly
 * `<prefix>${Date.now()}`; only those stamped before RUN_STARTED_AT are
 * archived as leftovers of an earlier run (lineup-leftovers.ts).
 */
const OWN_TITLE_PREFIXES = ['Poll Card '] as const;

/** Lineups stamped at or after this instant belong to the current run. */
const RUN_STARTED_AT = Date.now();

export async function deleteLineup(api: ApiClient, id: number): Promise<void> {
  await api.delete(`/lineups/${id}`).catch(() => {
    return api
      .patch(`/lineups/${id}/status`, { status: 'archived' })
      .catch(() => null);
  });
}

/**
 * Build a lineup whose single nominated game clears the match threshold,
 * then advance it to `decided` so the match enters the scheduling phase.
 */
export async function buildDecidedLineup(
  api: ApiClient,
  title: string,
): Promise<LineupPayload> {
  const created = await api.post<LineupPayload>('/lineups', {
    title,
    description: 'ROK-1473 scheduling poll card smoke',
    buildingDurationHours: 720,
    votingDurationHours: 720,
    decidedDurationHours: 720,
    matchThreshold: 10,
  });

  const gamesRes = await api.get<{ data: { id: number }[] }>(
    '/games/configured',
  );
  const gameId = gamesRes?.data?.[0]?.id;
  if (gameId === undefined) throw new Error('Need at least 1 configured game');

  await api.post(`/lineups/${created.id}/nominate`, { gameId });
  await api.patch(`/lineups/${created.id}/status`, { status: 'voting' });
  await api.post(`/lineups/${created.id}/vote`, { gameId });
  await api.patch(`/lineups/${created.id}/status`, { status: 'decided' });
  return created;
}

/**
 * The match the decide produced, once it reached `scheduling`.
 * `/lineups/:id/matches` groups by phase — `scheduling` is the bucket a
 * threshold-clearing match lands in (ROK-937).
 */
export async function loadSchedulingMatch(
  api: ApiClient,
  lineupId: number,
): Promise<MatchPayload> {
  const res = await api.get<{ scheduling?: MatchPayload[] }>(
    `/lineups/${lineupId}/matches`,
  );
  const match = res?.scheduling?.[0];
  if (!match) {
    throw new Error(`No scheduling match created for lineup ${lineupId}`);
  }
  return match;
}

/** The poll link the card must carry as its call to action. */
function assertPollLink(
  embed: SimpleEmbed,
  lineupId: number,
  matchId: number,
): void {
  const path = `/community-lineup/${lineupId}/schedule/${matchId}`;
  if (!(embed.description ?? '').includes(path)) {
    throw new Error(
      `Expected the poll card description to link ${path}, got "${embed.description}"`,
    );
  }
}

/** The card must announce itself as an OPEN poll (ROK-1461 author line). */
export function assertPollOpen(embed: SimpleEmbed): void {
  if (!(embed.author ?? '').includes(POLL_OPEN)) {
    throw new Error(
      `Expected the poll card author to contain "${POLL_OPEN}", got "${embed.author}"`,
    );
  }
}


/** A slot as the poll page returns it. */
interface PollSlot {
  id: number;
  proposedTime: string;
  votes: unknown[];
}

/** Discord timestamp token for an ISO instant, as the card renders it. */
function slotToken(iso: string): string {
  return `<t:${Math.floor(new Date(iso).getTime() / 1000)}:f>`;
}

/**
 * The ONE order (ROK-1548): votes desc, then earliest time, then lowest id.
 * Spelled out here as the test's oracle — the embed must agree with it.
 */
function expectedSlotOrder(slots: PollSlot[]): PollSlot[] {
  return [...slots].sort(
    (a, b) =>
      b.votes.length - a.votes.length ||
      new Date(a.proposedTime).getTime() - new Date(b.proposedTime).getTime() ||
      a.id - b.id,
  );
}

/**
 * ROK-1548 (audit F-03) — suggest two times that TIE on votes (suggesting
 * auto-votes, so each carries exactly one), the later one first so DB order
 * disagrees with the rule, and assert the card lists them in the order the
 * web page and lock-in use.
 */
async function assertTiedSlotsShareTheWebOrder(
  ctx: TestContext,
  lineupId: number,
  matchId: number,
  channelId: string,
  path: string,
): Promise<void> {
  const base = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const later = new Date(base + 3 * 60 * 60 * 1000).toISOString();
  const earlier = new Date(base).toISOString();
  const suggest = (proposedTime: string) =>
    ctx.api.post(`/lineups/${lineupId}/schedule/${matchId}/suggest`, {
      proposedTime,
    });
  await suggest(later);
  await suggest(earlier);
  await awaitProcessing(ctx.api);

  const page = await ctx.api.get<{ slots: PollSlot[] }>(
    `/lineups/${lineupId}/schedule/${matchId}`,
  );
  const tokens = expectedSlotOrder(page.slots ?? []).map((s) =>
    slotToken(s.proposedTime),
  );
  const msg = await waitForEmbedUpdate(
    channelId,
    (m) =>
      m.embeds.some(
        (e) =>
          (e.description ?? '').includes(path) &&
          tokens.every((t) => (e.description ?? '').includes(t)),
      ),
    ctx.config.timeoutMs,
  );
  const description =
    msg.embeds.find((e) => (e.description ?? '').includes(path))?.description ??
    '';
  const positions = tokens.map((t) => description.indexOf(t));
  const rendered = [...positions].sort((a, b) => a - b);
  if (positions.join(',') !== rendered.join(',')) {
    throw new Error(
      `Card slot order disagrees with the web/API order (${tokens.join(' then ')}): "${description}"`,
    );
  }
}

const schedulingPollCardPosted: SmokeTest = {
  name: 'Lineup match entering scheduling posts its poll card (ROK-1473)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveOwnLeftoverLineups(ctx.api, OWN_TITLE_PREFIXES, RUN_STARTED_AT);
    // Fence the channel BEFORE the lineup exists: CI reseeds the same
    // lineup/match ids, so a prior run's card can carry this run's exact
    // href, and the oldest match would win (TDB:1459).
    const channelId = await resolveLineupChannelId(
      ctx.api,
      ctx.defaultChannelId,
    );
    const ghostIds = await snapshotMessageIds(channelId);

    const title = `Poll Card ${Date.now()}`;
    const lineup = await buildDecidedLineup(ctx.api, title);

    try {
      await awaitProcessing(ctx.api);
      const match = await loadSchedulingMatch(ctx.api, lineup.id);
      const path = `/community-lineup/${lineup.id}/schedule/${match.id}`;

      const msg = await pollForEmbed(
        channelId,
        (m) => m.embeds.some((e) => (e.description ?? '').includes(path)),
        ctx.config.timeoutMs,
        { excludeIds: ghostIds },
      );

      const embed = msg.embeds.find((e) =>
        (e.description ?? '').includes(path),
      );
      if (!embed) throw new Error(`Poll card for ${path} vanished from message`);
      assertPollLink(embed, lineup.id, match.id);
      assertPollOpen(embed);
      await assertTiedSlotsShareTheWebOrder(
        ctx,
        lineup.id,
        match.id,
        channelId,
        path,
      );
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const schedulingPollCardTests: SmokeTest[] = [schedulingPollCardPosted];
