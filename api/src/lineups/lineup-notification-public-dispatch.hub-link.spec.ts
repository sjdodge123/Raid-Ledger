/**
 * ROK-1872 (ROK-1428 §2.8): the lineup decided + event-created cards carry
 * the game's hub link; without a hub the ctx has no `hubLink` key.
 */
import { postChannelEmbed } from './lineup-notification-dispatch.helpers';
import {
  resolveEventHubLink,
  resolveLineupDecidedHubLink,
} from '../discord-bot/channel-lifecycle/embed-hub-link.helpers';
import { resolveGameHubLinkSafe } from '../discord-bot/channel-lifecycle/hub-link.resolver';
import {
  orchestrateEventCreated,
  orchestrateMatchesFound,
  type OrchestrationDeps,
} from './lineup-notification-public-dispatch.helpers';
import type { MatchInfo } from './lineup-notification.service';

const BASE = 'https://raid.example.com';
jest.mock('./lineup-notification-dispatch.helpers', () => ({
  postChannelEmbed: jest.fn(),
  resolveEmbedCtx: jest.fn(() => Promise.resolve({ baseUrl: BASE })),
}));
jest.mock('./lineup-notification-dm-batch.helpers', () => ({
  fanOutMatchMemberDMs: jest.fn(),
  fanOutSchedulingDMs: jest.fn(),
  fanOutEventCreatedDMs: jest.fn(),
}));
jest.mock('./lineup-notification-targets.helpers', () => ({
  findMatchMemberUsers: jest.fn(() => Promise.resolve([])),
}));
jest.mock('./lineup-decision-reason.helpers', () => ({
  loadDecisionReason: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('./lineup-notification-event-roster.helpers', () => ({
  resolveEventRosterNames: jest.fn(() => Promise.resolve([])),
}));
jest.mock('./lineup-notification-routing.helpers', () => ({
  routeMatchesFoundIfPrivate: jest.fn(() => Promise.resolve(false)),
  routeEventCreatedIfPrivate: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('../discord-bot/channel-lifecycle/embed-hub-link.helpers', () => ({
  ...jest.requireActual<object>(
    '../discord-bot/channel-lifecycle/embed-hub-link.helpers',
  ),
  resolveEventHubLink: jest.fn(),
  resolveLineupDecidedHubLink: jest.fn(),
}));
jest.mock('../discord-bot/channel-lifecycle/hub-link.resolver', () => ({
  resolveGameHubLinkSafe: jest.fn(),
}));

const HUB = { url: `${BASE}/guilds/7`, label: 'Hub' as const };
const post = jest.mocked(postChannelEmbed);
const decided = jest.mocked(resolveLineupDecidedHubLink);
const forEvent = jest.mocked(resolveEventHubLink);
const forGame = jest.mocked(resolveGameHubLinkSafe);
const MATCH: MatchInfo = {
  ...{ id: 3, lineupId: 9, gameId: 5, gameName: 'WoW', status: 'decided' },
  ...{ thresholdMet: true, voteCount: 4 },
};
const DATE = new Date('2026-11-01T20:00:00Z');
const settingsService = { getDefaultTimezone: jest.fn(() => 'UTC') };
const deps = { db: {}, settingsService } as unknown as OrchestrationDeps;

function postedCtx(): object {
  const ctx: unknown = post.mock.calls[0]?.[3];
  if (typeof ctx !== 'object' || ctx === null) throw new Error('no ctx');
  return ctx;
}

describe('lineup dispatch — hub link (ROK-1872)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('decided card carries the decided game hub link', async () => {
    decided.mockResolvedValueOnce(HUB);
    await orchestrateMatchesFound(deps, 9, [MATCH]);
    expect(decided).toHaveBeenCalledWith({}, 9, BASE, expect.anything());
    expect(postedCtx()).toMatchObject({ hubLink: HUB });
  });

  it('decided card without a hub has no hubLink key', async () => {
    decided.mockResolvedValueOnce(null);
    await orchestrateMatchesFound(deps, 9, [MATCH]);
    expect('hubLink' in postedCtx()).toBe(false);
  });

  it('event-created card resolves via the event when it has one', async () => {
    forEvent.mockResolvedValueOnce(HUB);
    await orchestrateEventCreated(deps, MATCH, DATE, 77);
    expect(forEvent).toHaveBeenCalledWith({}, 77, BASE, expect.anything());
    expect(postedCtx()).toMatchObject({ hubLink: HUB });
  });

  it('event-created card falls back to the match game without an event', async () => {
    forGame.mockResolvedValueOnce(null);
    await orchestrateEventCreated(deps, MATCH, DATE, undefined);
    expect(forGame).toHaveBeenCalledWith(
      {},
      { gameId: 5, clientUrl: BASE },
      expect.anything(),
    );
    expect('hubLink' in postedCtx()).toBe(false);
  });
});
