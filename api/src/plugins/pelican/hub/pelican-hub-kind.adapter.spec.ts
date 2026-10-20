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
import type { ServerHubMembershipService } from './server-hub-membership.service';

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
