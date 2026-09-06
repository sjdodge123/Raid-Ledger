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
import { routeMatchesFoundIfPrivate } from './lineup-notification-routing.helpers';
import { sendMatchesFoundDM } from './lineup-notification-private-dm.helpers';
import type { OrchestrationDeps } from './lineup-notification-public-dispatch.helpers';
import type { MatchInfo } from './lineup-notification.service';
import type { NotificationService } from '../notifications/notification.service';
import type { NotificationDedupService } from '../notifications/notification-dedup.service';
import type { DiscordMember } from './lineup-notification-dm.helpers';

const loadReason = loadDecisionReason as jest.Mock;
const routePrivate = routeMatchesFoundIfPrivate as jest.Mock;

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

const MEMBER: DiscordMember = {
  id: 7,
  userId: 7,
  displayName: 'Invitee',
  discordId: '1234',
};

/** A DM sender wired to fakes, returning the one message it created. */
async function privateDmBody(reason: string | null): Promise<string> {
  const created: string[] = [];
  const notificationService = {
    create: jest.fn((n: { message: string }) => {
      created.push(n.message);
      return Promise.resolve();
    }),
  } as unknown as NotificationService;
  const dedupService = {
    checkAndMarkSent: jest.fn().mockResolvedValue(false),
  } as unknown as NotificationDedupService;
  await sendMatchesFoundDM(
    notificationService,
    dedupService,
    { id: LINEUP_ID },
    1,
    MEMBER,
    reason,
  );
  expect(created).toHaveLength(1);
  return created[0];
}

describe('orchestrateMatchesFound — the private route carries the same reasoning', () => {
  beforeEach(() => {
    loadReason.mockResolvedValue(null);
    routePrivate.mockClear();
    routePrivate.mockResolvedValue(false);
  });

  it('resolves the reasoning BEFORE the private-route short circuit', async () => {
    loadReason.mockResolvedValue(REASON);
    routePrivate.mockResolvedValue(true);
    posted = null;

    await orchestrateMatchesFound(deps, LINEUP_ID, MATCHES);

    expect(posted).toBeNull();
    expect(routePrivate).toHaveBeenCalledWith(
      deps.db,
      deps.notificationService,
      deps.dedupService,
      { id: LINEUP_ID },
      MATCHES.length,
      REASON,
    );
  });

  it("renders the reasoning in the invitee's decided DM body", async () => {
    expect(await privateDmBody(REASON)).toContain(`\u2B50 _${REASON}_`);
  });

  it('keeps the DM silent about top picks when there is no reasoning', async () => {
    const body = await privateDmBody(null);
    expect(body).not.toContain(REASON);
    expect(body).not.toContain('\u2B50');
  });
});
