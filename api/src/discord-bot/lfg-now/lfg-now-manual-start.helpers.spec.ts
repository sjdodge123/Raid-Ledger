/**
 * Unit specs for the MANUAL "start playing now" branch (ROK-1613 AC1/AC2/AC4).
 *
 * The manual branch shares `spawnUnderGroupLock` with the threshold path
 * (AC2 — no second create path), so these specs drive the public entry point
 * with `opts.manual` and assert on what changed: no threshold guard, a creator
 * taken from the request rather than `hands[0]`, exactly one rostered player,
 * and the OTHER participants returned for invite instead of signed up.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { spawnUnderGroupLock, type LfgNowHand } from './lfg-now-spawn.helpers';
import { listLiveGroupHands, convertStarterIntent } from './lfg-now-manual-start.helpers';
import { createLfgNowEventRow } from './lfg-now-event.helpers';
import { convertGroup } from '../../lfg/lfg-write.helpers';
import { autoSignupParticipant } from '../services/ad-hoc-event.signup-helpers';

jest.mock('./lfg-now-event.helpers', () => ({
  createLfgNowEventRow: jest.fn(),
}));
jest.mock('../../lfg/lfg-write.helpers', () => ({ convertGroup: jest.fn() }));
jest.mock('../services/ad-hoc-event.signup-helpers', () => ({
  autoSignupParticipant: jest.fn(),
}));
jest.mock('./lfg-now-manual-start.helpers', () => ({
  listLiveGroupHands: jest.fn(),
  convertStarterIntent: jest.fn(),
}));

const createRow = createLfgNowEventRow as jest.MockedFunction<
  typeof createLfgNowEventRow
>;
const convert = convertGroup as jest.MockedFunction<typeof convertGroup>;
const signup = autoSignupParticipant as jest.MockedFunction<
  typeof autoSignupParticipant
>;
const groupHands = listLiveGroupHands as jest.MockedFunction<
  typeof listLiveGroupHands
>;
const convertStarter = convertStarterIntent as jest.MockedFunction<
  typeof convertStarterIntent
>;

const GAME_ID = 42;
const STARTER_ID = 7;
const NOW = new Date('2026-09-18T20:00:00.000Z');

function hand(over: Partial<LfgNowHand> = {}): LfgNowHand {
  return {
    userId: STARTER_ID,
    createdAt: new Date('2026-09-18T19:00:00.000Z'),
    discordId: 'discord-7',
    username: 'metaveix',
    discordAvatarHash: null,
    ...over,
  };
}

/** `findOpenLfgNowEvent` terminates on `.limit`, now-hands on `.orderBy`. */
function mockDb(openEventIds: number[], nowHands: LfgNowHand[]): MockDb {
  const db = createDrizzleMock();
  db.limit.mockResolvedValue(openEventIds.map((id) => ({ id })));
  db.orderBy.mockResolvedValue(nowHands);
  return db;
}

const asDb = (db: MockDb) => db as never;

beforeEach(() => {
  jest.clearAllMocks();
  createRow.mockResolvedValue(900);
  convert.mockResolvedValue(1);
  convertStarter.mockResolvedValue(1);
  signup.mockResolvedValue(undefined);
  groupHands.mockResolvedValue([hand()]);
});

describe('spawnUnderGroupLock — manual start (ROK-1613)', () => {
  it('starts with a WEEK-hand starter and zero now-hands (finding 2)', async () => {
    // MUTATION: drop `opts.manual`'s explicit creator and read `hands[0]`
    // instead and this throws `Cannot read properties of undefined`.
    groupHands.mockResolvedValue([hand()]);
    const db = mockDb([], []); // no `urgency = 'now'` hands at all

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(result).toEqual({
      eventId: 900,
      spawned: true,
      invitedUserIds: [],
    });
    expect(createRow).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      STARTER_ID,
      NOW,
    );
  });

  it('skips the now-hand threshold guard (AC1)', async () => {
    // MUTATION: keep the `hands.length < LFG_NOW_SPAWN_THRESHOLD` guard on the
    // manual branch and this resolves to null instead of an event.
    const db = mockDb([], []);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(result?.eventId).toBe(900);
    expect(createRow).toHaveBeenCalledTimes(1);
  });

  it('rosters ONLY the starter and returns the others for invite (AC4)', async () => {
    // MUTATION: sign the whole group up (`signupNowHands(tx, id, participants)`)
    // and `signup` is called 3× with an empty `invitedUserIds`.
    groupHands.mockResolvedValue([
      hand(),
      hand({ userId: 8, discordId: 'discord-8', username: 'bob' }),
      hand({ userId: 9, discordId: 'discord-9', username: 'cara' }),
    ]);
    const db = mockDb([], []);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(result?.invitedUserIds).toEqual([8, 9]);
    expect(signup).toHaveBeenCalledTimes(1);
    expect(signup).toHaveBeenCalledWith(expect.anything(), 900, {
      discordUserId: 'discord-7',
      discordUsername: 'metaveix',
      discordAvatarHash: null,
      userId: STARTER_ID,
    });
  });

  it('converts ONLY the starter, never the whole group (AC4 / spec §4)', async () => {
    // MUTATION: swap `convertStarterIntent` for `convertGroup` and the invited
    // week-hander loses the hand they never accepted with.
    groupHands.mockResolvedValue([hand(), hand({ userId: 8, discordId: 'd-8' })]);
    const db = mockDb([], []);

    await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(convertStarter).toHaveBeenCalledWith(
      expect.anything(),
      GAME_ID,
      STARTER_ID,
      { eventId: 900 },
    );
    expect(convert).not.toHaveBeenCalled();
  });

  it('ATTACHES to the open session instead of minting a second one (AC5)', async () => {
    // MUTATION: ignore `findOpenLfgNowEvent` on the manual branch and a second
    // press mints a duplicate event.
    groupHands.mockResolvedValue([hand(), hand({ userId: 8, discordId: 'd-8' })]);
    const db = mockDb([555], []);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(result).toEqual({
      eventId: 555,
      spawned: false,
      invitedUserIds: [8],
    });
    expect(createRow).not.toHaveBeenCalled();
  });

  it('still rosters a starter who has no linked Discord account', async () => {
    // MUTATION: drop the `discordId` guard in `signupNowHands` and this throws.
    groupHands.mockResolvedValue([hand({ discordId: null })]);
    const db = mockDb([], []);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW, {
      manual: { starterUserId: STARTER_ID },
    });

    expect(result?.eventId).toBe(900);
    expect(signup).not.toHaveBeenCalled();
    expect(convertStarter).toHaveBeenCalledTimes(1);
  });

  it('leaves the threshold path untouched — no manual opts, no group read', async () => {
    // MUTATION: run the manual branch unconditionally and the threshold path
    // stops converting the group.
    const db = mockDb([], [hand({ userId: 1, discordId: 'd-1' }), hand({ userId: 2, discordId: 'd-2' })]);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(result).toEqual({ eventId: 900, spawned: true, invitedUserIds: [] });
    expect(groupHands).not.toHaveBeenCalled();
    expect(convert).toHaveBeenCalledWith(expect.anything(), GAME_ID, {
      eventId: 900,
    });
  });
});
