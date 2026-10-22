/**
 * ROK-1832 — the `game_server` hub kind's member set. The SQL semantics of
 * the L-2 membership window are proven in `pelican-hub.integration.spec.ts`
 * and `hub-notification-mute-routes.integration.spec.ts`; this pins the
 * adapter wiring (distinct user ids, one per live membership row).
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import type * as schema from '../../../drizzle/schema';
import { PelicanHubKindAdapter } from './pelican-hub-kind.adapter';
import type { GuildRaidsDto } from '@raid-ledger/contract';
import { loadCommunityHubEvents } from '../../../guilds/community/community-events.queries';
import type { GuildActor } from '../../../guilds/guild-access.service';
import type { ServerHubMembershipService } from './server-hub-membership.service';

jest.mock('../../../guilds/community/community-events.queries', () => ({
  loadCommunityHubEvents: jest.fn(),
}));

let db: MockDb;
let adapter: PelicanHubKindAdapter;

beforeEach(() => {
  db = createDrizzleMock();
  const asDb: unknown = db;
  const membership: unknown = {};
  adapter = new PelicanHubKindAdapter(
    asDb as PostgresJsDatabase<typeof schema>,
    membership as ServerHubMembershipService,
  );
});

describe('ROK-1832 PelicanHubKindAdapter.memberUserIds', () => {
  it('returns the live members of the hub (set form of isMember)', async () => {
    db.where.mockResolvedValueOnce([{ userId: 5 }, { userId: 6 }]);
    await expect(adapter.memberUserIds(11)).resolves.toEqual([5, 6]);
    expect(db.selectDistinct).toHaveBeenCalled();
  });

  it('omits a non-member — no live row, no id', async () => {
    db.where.mockResolvedValueOnce([{ userId: 5 }]);
    expect(await adapter.memberUserIds(11)).not.toContain(42);
  });
});

describe('PelicanHubKindAdapter.raids — events tagged to a server hub', () => {
  const actor: GuildActor = { id: 7, role: 'member' };
  const events: GuildRaidsDto = {
    upcoming: [],
    recent: [],
    schedule: [],
    composition: null,
    attendance: { windowWeeks: 8, rows: [] },
    nextRaid: null,
  };

  it('returns the hub\'s tagged events from the shared loader, not a hard-coded empty list', async () => {
    db.limit.mockResolvedValueOnce([{ id: 1 }]);
    jest.mocked(loadCommunityHubEvents).mockResolvedValueOnce(events);
    await expect(adapter.raids(actor, 1)).resolves.toBe(events);
    expect(loadCommunityHubEvents).toHaveBeenCalledWith(db, 1, 7);
  });

  it('404s an unknown hub without loading events', async () => {
    db.limit.mockResolvedValueOnce([]);
    jest.mocked(loadCommunityHubEvents).mockClear();
    await expect(adapter.raids(actor, 99)).rejects.toThrow('Guild not found');
    expect(loadCommunityHubEvents).not.toHaveBeenCalled();
  });
});
