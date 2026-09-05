/**
 * ROK-1474 (C3) — the decided card actually receives its reasoning.
 *
 * The rendering is pinned in `lineup-notification-embed.shape.spec.ts` and the
 * silence guards in `lineup-decision-reason.helpers.spec.ts`; what neither
 * proves is that the dispatch chain THREADS the two together. This drives the
 * real `orchestrateMatchesFound` with the routing, context and post seams
 * mocked, and asserts on the embed the real `buildDecidedEmbed` produced —
 * so deleting the `decisionReason` line from the context fails here, not in
 * an integration suite nobody runs locally.
 */
import type { EmbedBuilder } from 'discord.js';
import type {
  EmbedContext,
  EmbedWithRow,
} from './lineup-notification-embed.helpers';

const REASON = 'tied on votes 5–5, won on top picks 4–1';
const LINEUP_ID = 42;

let posted: EmbedBuilder | null = null;

jest.mock('./lineup-notification-routing.helpers', () => ({
  routeMatchesFoundIfPrivate: jest.fn().mockResolvedValue(false),
  routeNominationMilestoneIfPrivate: jest.fn().mockResolvedValue(false),
  routeSchedulingOpenIfPrivate: jest.fn().mockResolvedValue(false),
  routeEventCreatedIfPrivate: jest.fn().mockResolvedValue(false),
}));
jest.mock('./lineup-notification-dm-batch.helpers', () => ({
  fanOutMatchMemberDMs: jest.fn().mockResolvedValue(undefined),
  fanOutSchedulingDMs: jest.fn().mockResolvedValue(undefined),
  fanOutEventCreatedDMs: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('./lineup-notification-dispatch.helpers', () => ({
  resolveEmbedCtx: jest.fn((): EmbedContext => ({
    baseUrl: 'https://raid.example',
    lineupId: LINEUP_ID,
    communityName: 'Test Guild',
    phase: 'decided',
    lineupTitle: 'September Lineup',
  })),
  postChannelEmbed: jest.fn(
    async (
      _deps: unknown,
      _key: string,
      build: (ctx: EmbedContext) => Promise<EmbedWithRow | null>,
      ctx: EmbedContext,
    ) => {
      posted = (await build(ctx))?.embed ?? null;
    },
  ),
}));
jest.mock('./lineup-decision-reason.helpers', () => ({
  loadDecisionReason: jest.fn().mockResolvedValue(null),
}));

import { orchestrateMatchesFound } from './lineup-notification-public-dispatch.helpers';
import { loadDecisionReason } from './lineup-decision-reason.helpers';
import type { OrchestrationDeps } from './lineup-notification-public-dispatch.helpers';
import type { MatchInfo } from './lineup-notification.service';

const loadReason = loadDecisionReason as jest.Mock;

const MATCHES: MatchInfo[] = [
  {
    id: 1,
    lineupId: LINEUP_ID,
    gameId: 1,
    gameName: 'Deep Rock',
    thresholdMet: true,
    voteCount: 5,
    status: 'scheduling',
  },
];

const deps = {} as OrchestrationDeps;

async function decidedDescription(): Promise<string> {
  posted = null;
  await orchestrateMatchesFound(deps, LINEUP_ID, MATCHES);
  expect(posted).not.toBeNull();
  return posted!.toJSON().description ?? '';
}

describe('orchestrateMatchesFound — reasoning reaches the decided embed', () => {
  beforeEach(() => {
    loadReason.mockResolvedValue(null);
  });

  it('renders the loaded reasoning on the posted decided embed', async () => {
    loadReason.mockResolvedValue(REASON);
    expect(await decidedDescription()).toContain(`⭐ _${REASON}_`);
  });

  it('looks the reasoning up for the lineup being announced', async () => {
    loadReason.mockResolvedValue(REASON);
    await decidedDescription();
    expect(loadReason).toHaveBeenCalledWith(deps.db, LINEUP_ID);
  });

  it('posts a card with no top-pick claim when there is no reasoning', async () => {
    expect(await decidedDescription()).not.toContain('top picks');
  });
});
