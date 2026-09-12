/**
 * Unit coverage for the invitee audit column (ROK-1101 G2).
 *
 * `community_lineup_invitees.invited_by` records WHO issued the invite so the
 * roster is auditable after the fact. These assertions pin the two halves of
 * that thread: the write path stamps the actor, and the read path surfaces it.
 */
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import {
  addInvitees,
  listInviteesWithProfile,
} from './lineups-invitees.helpers';

type Db = Parameters<typeof addInvitees>[0];

describe('lineups-invitees.helpers — invited_by audit column (ROK-1101 G2)', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createDrizzleMock();
  });

  it('stamps the inviting actor on every inserted invitee row', async () => {
    mockDb.where.mockResolvedValueOnce([{ id: 20 }, { id: 21 }]);

    await addInvitees(mockDb as unknown as Db, 7, [20, 21], 9);

    expect(mockDb.values).toHaveBeenCalledWith([
      { lineupId: 7, userId: 20, invitedBy: 9 },
      { lineupId: 7, userId: 21, invitedBy: 9 },
    ]);
  });

  it('records a null actor when the invite has no attributable caller', async () => {
    mockDb.where.mockResolvedValueOnce([{ id: 20 }]);

    await addInvitees(mockDb as unknown as Db, 7, [20], null);

    expect(mockDb.values).toHaveBeenCalledWith([
      { lineupId: 7, userId: 20, invitedBy: null },
    ]);
  });

  it('surfaces invitedBy on the detail-response rows', async () => {
    mockDb.where.mockResolvedValueOnce([
      { id: 20, displayName: 'Alice', steamId: 'S1', invitedBy: 9 },
      { id: 21, displayName: 'Bob', steamId: null, invitedBy: null },
    ]);

    const rows = await listInviteesWithProfile(mockDb as unknown as Db, 7);

    expect(rows).toEqual([
      { id: 20, displayName: 'Alice', steamLinked: true, invitedBy: 9 },
      { id: 21, displayName: 'Bob', steamLinked: false, invitedBy: null },
    ]);
  });
});
