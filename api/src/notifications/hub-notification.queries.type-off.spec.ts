/**
 * ROK-1832 (Codex r6 P2): `NotificationService.create` drops a notice whose
 * type has `inApp` off before it dispatches Discord, so a group copy with
 * `hub_event_tagged: { inApp: false, discord: true }` is never delivered. Such
 * a user must count as "group type off" so the plan sends their game copy.
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
  it('counts inApp off as off even when discord is on (create gates on inApp)', async () => {
    const db = dbReturning([
      { userId: 1, prefs: channels(false, true) },
      { userId: 2, prefs: channels(false, false) },
      { userId: 3, prefs: channels(true, false) },
      { userId: 4, prefs: channels(true, true) },
      { userId: 5, prefs: {} },
    ]);
    const off = await findGroupTypeOff(db, [1, 2, 3, 4, 5]);
    expect([...off].sort()).toEqual([1, 2]);
  });

  it('reads nothing for an empty recipient list', async () => {
    const db = dbReturning([]);
    expect(await findGroupTypeOff(db, [])).toEqual(new Set());
    expect(db.select).not.toHaveBeenCalled();
  });
});
