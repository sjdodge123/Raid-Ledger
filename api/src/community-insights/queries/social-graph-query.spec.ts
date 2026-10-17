import type {
  SocialGraphEdgeDto,
  SocialGraphNodeDto,
} from '@raid-ledger/contract';
import { buildSnapshotFixture } from '../__fixtures__/snapshot-fixture';
import type {
  CommunityInsightsService,
  CommunityInsightsSnapshotRow,
} from '../community-insights.service';
import { getSocialGraphResponse } from './social-graph-query';

const SNAPSHOT_DATE = '2026-04-22';

function node(userId: number, degree: number): SocialGraphNodeDto {
  return {
    userId,
    username: `user-${userId}`,
    avatar: null,
    intensityTier: 'Regular',
    cliqueId: 0,
    degree,
  };
}

function stubService(
  nodes: SocialGraphNodeDto[],
  edges: SocialGraphEdgeDto[],
): CommunityInsightsService {
  const fixture = buildSnapshotFixture(SNAPSHOT_DATE);
  const row = {
    snapshotDate: SNAPSHOT_DATE,
    socialGraphPayload: {
      ...fixture.socialGraph,
      nodes,
      edges,
      cliques: [],
      tasteLeaders: [],
    },
  } as unknown as CommunityInsightsSnapshotRow;
  return {
    readLatestSnapshot: () => Promise.resolve(row),
  } as unknown as CommunityInsightsService;
}

function degreesById(nodes: SocialGraphNodeDto[]): Record<number, number> {
  return Object.fromEntries(nodes.map((n) => [n.userId, n.degree]));
}

describe('getSocialGraphResponse — node degree', () => {
  it('reports degree within the returned edge set after minWeight filtering', async () => {
    const service = stubService(
      [node(1, 5), node(2, 3), node(3, 1), node(4, 1)],
      [
        { sourceUserId: 1, targetUserId: 2, weight: 9 },
        { sourceUserId: 1, targetUserId: 3, weight: 1 },
        { sourceUserId: 1, targetUserId: 4, weight: 1 },
      ],
    );

    const res = await getSocialGraphResponse(service, { minWeight: 5 });

    expect(res?.edges).toHaveLength(1);
    expect(degreesById(res?.nodes ?? [])).toEqual({ 1: 1, 2: 1 });
  });

  it('drops nodes whose every edge was filtered out', async () => {
    const service = stubService(
      [node(1, 5), node(2, 3), node(3, 1)],
      [
        { sourceUserId: 1, targetUserId: 2, weight: 9 },
        { sourceUserId: 1, targetUserId: 3, weight: 1 },
      ],
    );

    const res = await getSocialGraphResponse(service, { minWeight: 5 });

    expect(res?.nodes.map((n) => n.userId)).toEqual([1, 2]);
  });

  it('still ranks the node cap by stored full-graph degree', async () => {
    // Node 3 has the most visible edges but the lowest stored degree, so
    // the cap of 2 keeps nodes 1 and 2 and only their shared edge survives.
    const service = stubService(
      [node(1, 5), node(2, 4), node(3, 1)],
      [
        { sourceUserId: 1, targetUserId: 2, weight: 1 },
        { sourceUserId: 1, targetUserId: 3, weight: 1 },
        { sourceUserId: 2, targetUserId: 3, weight: 1 },
      ],
    );

    const res = await getSocialGraphResponse(service, { limit: 2 });

    expect(degreesById(res?.nodes ?? [])).toEqual({ 1: 1, 2: 1 });
  });
});
