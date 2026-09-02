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
import { pollForEmbed } from '../../helpers/polling.js';
import { awaitProcessing } from '../fixtures.js';
import type { SmokeTest, TestContext } from '../types.js';
import type { SimpleEmbed } from '../../helpers/messages.js';
import type { ApiClient } from '../api.js';

interface LineupPayload {
  id: number;
  [k: string]: unknown;
}

interface MatchPayload {
  id: number;
  [k: string]: unknown;
}

/** ROK-1461 author line for an open scheduling poll. */
const POLL_OPEN = 'POLL OPEN';

/**
 * Resolve the channel the poll card routes to.
 *
 * The card follows the LINEUP chain (per-lineup override → admin lineup
 * channel → default announcement channel), so polling `defaultChannelId`
 * blindly times out on an environment that configured a lineup channel.
 */
async function resolveLineupChannelId(
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

/** Archive any active lineup so a fresh one can be created. */
async function archiveAllLineups(api: ApiClient): Promise<void> {
  try {
    const active = await api.get<{ id: number }>('/lineups/active');
    if (active?.id) {
      await api
        .patch(`/lineups/${active.id}/status`, { status: 'archived' })
        .catch(() => null);
    }
  } catch {
    // No active lineup — nothing to archive.
  }
}

async function deleteLineup(api: ApiClient, id: number): Promise<void> {
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
async function buildDecidedLineup(
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
async function loadSchedulingMatch(
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
function assertPollOpen(embed: SimpleEmbed): void {
  if (!(embed.author ?? '').includes(POLL_OPEN)) {
    throw new Error(
      `Expected the poll card author to contain "${POLL_OPEN}", got "${embed.author}"`,
    );
  }
}

const schedulingPollCardPosted: SmokeTest = {
  name: 'Lineup match entering scheduling posts its poll card (ROK-1473)',
  category: 'embed',
  async run(ctx: TestContext) {
    await archiveAllLineups(ctx.api);

    const title = `Poll Card ${Date.now()}`;
    const lineup = await buildDecidedLineup(ctx.api, title);

    try {
      await awaitProcessing(ctx.api);
      const match = await loadSchedulingMatch(ctx.api, lineup.id);
      const path = `/community-lineup/${lineup.id}/schedule/${match.id}`;
      const channelId = await resolveLineupChannelId(
        ctx.api,
        ctx.defaultChannelId,
      );

      const msg = await pollForEmbed(
        channelId,
        (m) => m.embeds.some((e) => (e.description ?? '').includes(path)),
        ctx.config.timeoutMs,
      );

      const embed = msg.embeds.find((e) =>
        (e.description ?? '').includes(path),
      );
      if (!embed) throw new Error(`Poll card for ${path} vanished from message`);
      assertPollLink(embed, lineup.id, match.id);
      assertPollOpen(embed);
    } finally {
      await deleteLineup(ctx.api, lineup.id);
    }
  },
};

export const schedulingPollCardTests: SmokeTest[] = [schedulingPollCardPosted];
