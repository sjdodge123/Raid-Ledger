/**
 * ROK-1832 (Codex r6 P2) / ROK-2290: a group copy that would reach a member on
 * no channel must count as "group type off" so the plan sends their game copy.
 * Since ROK-2290 bell off + Discord on still delivers (hidden row + DM), so
 * only BOTH switches off is "off"; a missing entry takes its default (on).
 */
import { findGroupTypeOff } from './hub-notification.queries';

type Db = Parameters<typeof findGroupTypeOff>[0];

const channels = (inApp: boolean, discord: boolean) => ({
  hub_event_tagged: { inApp, push: false, discord },
});

function dbReturning(rows: { userId: number; prefs: object }[]): Db {
  const where = jest.fn().mockResolvedValue(rows);
  const from = jest.fn().mockReturnValue({ where });
  return { select: jest.fn().mockReturnValue({ from }) } as unknown as Db;
}

describe('findGroupTypeOff', () => {
  it('counts only bell AND Discord off as off (bell off + Discord on still DMs)', async () => {
    const db = dbReturning([
      { userId: 1, prefs: channels(false, true) },
      { userId: 2, prefs: channels(false, false) },
      { userId: 3, prefs: channels(true, false) },
      { userId: 4, prefs: channels(true, true) },
      { userId: 5, prefs: {} },
    ]);
    const off = await findGroupTypeOff(db, [1, 2, 3, 4, 5]);
    expect([...off].sort()).toEqual([2]);
  });

  it('a partial entry takes the default for the missing switch', async () => {
    const db = dbReturning([
      { userId: 6, prefs: { hub_event_tagged: { inApp: false } } },
      { userId: 7, prefs: { hub_event_tagged: { discord: false } } },
    ]);
    expect(await findGroupTypeOff(db, [6, 7])).toEqual(new Set());
  });

  it('reads nothing for an empty recipient list', async () => {
    const db = dbReturning([]);
    expect(await findGroupTypeOff(db, [])).toEqual(new Set());
    expect(db.select).not.toHaveBeenCalled();
  });
});
