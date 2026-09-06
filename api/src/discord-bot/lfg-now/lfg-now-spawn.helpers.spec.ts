/**
 * Unit specs for the LFG "playing now" spawn decision (ROK-1494 AC1/AC5/AC9).
 *
 * The two DB reads inside the transaction terminate on DIFFERENT chain methods
 * — `findOpenLfgNowEvent` on `.limit()`, `listLiveNowHands` on `.orderBy()` —
 * so the drizzle mock can drive them independently. Everything the decision
 * DELEGATES (create / signup / convert) is mocked, because what is under test
 * here is which branch runs, not the SQL those three already own.
 */
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import { spawnUnderGroupLock, type LfgNowHand } from './lfg-now-spawn.helpers';
import { createLfgNowEventRow } from './lfg-now-event.helpers';
import { convertGroup } from '../../lfg/lfg-write.helpers';
import { autoSignupParticipant } from '../services/ad-hoc-event.signup-helpers';

jest.mock('./lfg-now-event.helpers', () => ({
  createLfgNowEventRow: jest.fn(),
}));
jest.mock('../../lfg/lfg-write.helpers', () => ({
  convertGroup: jest.fn(),
}));
jest.mock('../services/ad-hoc-event.signup-helpers', () => ({
  autoSignupParticipant: jest.fn(),
}));

const createRow = createLfgNowEventRow as jest.MockedFunction<
  typeof createLfgNowEventRow
>;
const convert = convertGroup as jest.MockedFunction<typeof convertGroup>;
const signup = autoSignupParticipant as jest.MockedFunction<
  typeof autoSignupParticipant
>;

const GAME_ID = 42;
const NOW = new Date('2026-09-06T12:00:00.000Z');

function hand(over: Partial<LfgNowHand> = {}): LfgNowHand {
  return {
    userId: 1,
    createdAt: new Date('2026-09-06T11:00:00.000Z'),
    discordId: 'discord-1',
    username: 'alice',
    discordAvatarHash: null,
    ...over,
  };
}

/** Wire the two reads: `openEvent` rows on `.limit`, hands on `.orderBy`. */
function mockDb(openEventIds: number[], hands: LfgNowHand[]): MockDb {
  const db = createDrizzleMock();
  db.limit.mockResolvedValue(openEventIds.map((id) => ({ id })));
  db.orderBy.mockResolvedValue(hands);
  return db;
}

const asDb = (db: MockDb) => db as any;

beforeEach(() => {
  jest.clearAllMocks();
  createRow.mockResolvedValue(900);
  convert.mockResolvedValue(2);
  signup.mockResolvedValue(undefined);
});

describe('spawnUnderGroupLock', () => {
  it('takes the LFG group advisory lock before reading anything', async () => {
    const db = mockDb([], [hand(), hand({ userId: 2 })]);
    await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);
    expect(db.execute).toHaveBeenCalledTimes(1);
    const [statement] = db.execute.mock.calls[0] as [
      { queryChunks: unknown[] },
    ];
    const rendered = JSON.stringify(statement);
    expect(rendered).toContain('pg_advisory_xact_lock');
    expect(rendered).toContain('lfg:42');
  });

  it('spawns once two now-hands are live, hosted by the EARLIEST hand', async () => {
    const early = hand({
      userId: 7,
      createdAt: new Date('2026-09-06T11:00:00.000Z'),
    });
    const late = hand({
      userId: 9,
      discordId: 'discord-9',
      createdAt: new Date('2026-09-06T11:30:00.000Z'),
    });
    const db = mockDb([], [early, late]);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(result).toEqual({ eventId: 900, spawned: true });
    expect(createRow).toHaveBeenCalledWith(expect.anything(), GAME_ID, 7, NOW);
    expect(signup).toHaveBeenCalledTimes(2);
    expect(convert).toHaveBeenCalledWith(expect.anything(), GAME_ID, {
      eventId: 900,
    });
  });

  it('does NOT spawn for a mixed group with only one now-hand (AC5, Q1)', async () => {
    const db = mockDb([], [hand()]);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(result).toBeNull();
    expect(createRow).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });

  it('does NOT spawn when nobody is looking', async () => {
    const db = mockDb([], []);
    await expect(
      spawnUnderGroupLock(asDb(db), GAME_ID, NOW),
    ).resolves.toBeNull();
    expect(createRow).not.toHaveBeenCalled();
  });

  it('ATTACHES to the open event instead of minting a second one (AC1 guard)', async () => {
    // Two live now-hands AND an already-open event: the threshold alone would
    // spawn again, so this asserts the guard, not the count.
    const db = mockDb([555], [hand(), hand({ userId: 2, discordId: 'd-2' })]);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(createRow).not.toHaveBeenCalled();
    expect(result).toEqual({ eventId: 555, spawned: false });
    expect(convert).toHaveBeenCalledWith(expect.anything(), GAME_ID, {
      eventId: 555,
    });
  });

  it('attaches a lone LATE third hand, below the threshold (AC1)', async () => {
    const third = hand({ userId: 3, discordId: 'd-3' });
    const db = mockDb([555], [third]);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(result).toEqual({ eventId: 555, spawned: false });
    expect(createRow).not.toHaveBeenCalled();
    expect(signup).toHaveBeenCalledWith(expect.anything(), 555, {
      discordUserId: 'd-3',
      discordUsername: 'alice',
      discordAvatarHash: null,
      userId: 3,
    });
  });

  it('converts nothing when the open event has no live hands left', async () => {
    const db = mockDb([555], []);

    const result = await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(result).toEqual({ eventId: 555, spawned: false });
    expect(convert).not.toHaveBeenCalled();
    expect(signup).not.toHaveBeenCalled();
  });

  it('skips a hand with no linked Discord account, still converting it', async () => {
    const unlinked = hand({ userId: 4, discordId: null });
    const db = mockDb([], [hand(), unlinked]);

    await spawnUnderGroupLock(asDb(db), GAME_ID, NOW);

    expect(signup).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledTimes(1);
  });
});
