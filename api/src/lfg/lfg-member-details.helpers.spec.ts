/**
 * ROK-2352 — `attachMemberDetails`: the roster gains each member's adapter
 * detail only for a scoped read with an active adapter.
 */
import type { LfgMemberDto } from '@raid-ledger/contract';
import { createDrizzleMock, type MockDb } from '../common/testing/drizzle-mock';
import type { LfgGroupingAdapter } from '../plugins/plugin-host/lfg-grouping.adapter';
import type { LfgDb } from './lfg-query.helpers';
import { attachMemberDetails } from './lfg-member-details.helpers';

function member(userId: number): LfgMemberDto {
  return {
    userId,
    username: `u${userId}`,
    displayName: null,
    avatarUrl: null,
    expiresAt: '2026-11-27T00:00:00.000Z',
    joinedAt: '2026-11-26T00:00:00.000Z',
    urgency: 'now',
  };
}

function adapterWith(
  details: Map<number, Record<string, unknown>>,
): LfgGroupingAdapter & { readMemberDetails: jest.Mock } {
  const readMemberDetails = jest.fn().mockResolvedValue(details);
  // Only `readMemberDetails` is reached by the helper under test.
  return { readMemberDetails } as unknown as LfgGroupingAdapter & {
    readMemberDetails: jest.Mock;
  };
}

let db: MockDb;
const asDb = (): LfgDb => db as unknown as LfgDb;

beforeEach(() => {
  db = createDrizzleMock();
});

describe('attachMemberDetails', () => {
  it('attaches the detail of each member hand in the scoped group', async () => {
    db.where.mockResolvedValueOnce([
      { id: 11, userId: 1 },
      { id: 12, userId: 2 },
    ]);
    const detail = { intentId: 11, roles: ['tank'] };
    const adapter = adapterWith(new Map([[11, detail]]));
    const out = await attachMemberDetails(asDb(), adapter, 5, 'dungeon:36', [
      member(1),
      member(2),
    ]);
    expect(adapter.readMemberDetails).toHaveBeenCalledWith({
      intentIds: [11, 12],
    });
    expect(out[0]?.pluginDetail).toEqual(detail);
    expect(out[1]).not.toHaveProperty('pluginDetail');
  });

  it('leaves the roster unchanged without an adapter', async () => {
    const members = [member(1)];
    const out = await attachMemberDetails(asDb(), null, 5, '', members);
    expect(out).toBe(members);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('leaves the folded (null-scope) read unchanged', async () => {
    const adapter = adapterWith(new Map());
    const members = [member(1)];
    const out = await attachMemberDetails(asDb(), adapter, 5, null, members);
    expect(out).toBe(members);
    expect(adapter.readMemberDetails).not.toHaveBeenCalled();
  });
});
