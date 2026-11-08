/**
 * ROK-2133: snapshot writes — member upsert/failure bookkeeping and the
 * compare-and-set copy onto an unlinked `characters` row.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../../common/testing/drizzle-mock';
import * as schema from '../../../drizzle/schema';
import {
  applySnapshotToCharacter,
  memberOwnedByCharacterSync,
  recordMemberFailure,
  writeMemberSnapshot,
} from './snapshot.apply';
import { nextRetryAt, type MemberArmorySnapshot } from './snapshot.helpers';

type Db = PostgresJsDatabase<typeof schema>;

const NOW = new Date('2026-11-08T12:00:00Z');
const SYNCED = new Date('2026-11-08T11:59:00Z');

const SNAPSHOT: MemberArmorySnapshot = {
  blizzardCharacterId: 12345,
  level: 42,
  class: 'Shaman',
  race: 'Orc',
  spec: 'Enhancement',
  role: 'dps',
  itemLevel: 51,
  avatarUrl: 'https://img/a.jpg',
  equipment: { items: [] },
  talents: { t: 1 },
  armoryProfessions: { primaries: [] },
  lastLoginAt: null,
  syncedAt: SYNCED,
};

/** The roster says 41 while Blizzard's profile still says 42/older. */
const TARGET = { memberId: 9, blizzardId: 12345, rosterLevel: 41 };

const dialect = new PgDialect();
const render = (q: unknown): string => dialect.sqlToQuery(q as SQL).sql;

function setup(): { mock: MockDb; db: Db } {
  const mock = createDrizzleMock();
  return { mock, db: mock as unknown as Db };
}

function firstArg(fn: jest.Mock): unknown {
  const call = fn.mock.calls[0];
  if (call === undefined) throw new Error('expected a call');
  return call[0];
}

describe('writeMemberSnapshot', () => {
  it('upserts the verified snapshot and clears the failure state', async () => {
    const { mock, db } = setup();
    await writeMemberSnapshot(db, TARGET, SNAPSHOT, NOW);
    expect(mock.insert).toHaveBeenCalledWith(schema.guildMemberArmory);
    const reset = { failures: 0, retryAt: null, lastError: null };
    const data = {
      ...SNAPSHOT,
      blizzardCharacterId: 12345,
      rosterLevel: 41,
      lastAttemptAt: NOW,
    };
    expect(mock.values).toHaveBeenCalledWith({
      guildMemberId: 9,
      ...data,
      ...reset,
    });
    const conflict = firstArg(mock.onConflictDoUpdate) as { set: object };
    expect(conflict.set).toEqual({ ...data, ...reset });
  });

  it('stamps syncedAt with now when the snapshot carries none', async () => {
    const { mock, db } = setup();
    await writeMemberSnapshot(
      db,
      TARGET,
      { ...SNAPSHOT, syncedAt: null },
      NOW,
    );
    expect(mock.values).toHaveBeenCalledWith(
      expect.objectContaining({ syncedAt: NOW }),
    );
  });
});

describe('recordMemberFailure', () => {
  it('counts the failure, backs off from the stored count, keeps the data', async () => {
    const { mock, db } = setup();
    mock.returning.mockResolvedValueOnce([{ failures: 3 }]);
    await recordMemberFailure(db, 9, 'not_found', NOW);
    expect(mock.values).toHaveBeenCalledWith({
      guildMemberId: 9,
      failures: 1,
      retryAt: nextRetryAt('not_found', 1, NOW),
      lastError: 'not_found',
      lastAttemptAt: NOW,
    });
    const conflict = firstArg(mock.onConflictDoUpdate) as { set: object };
    expect(Object.keys(conflict.set).sort()).toEqual(
      ['failures', 'lastAttemptAt', 'lastError'].sort(),
    );
    expect(mock.set).toHaveBeenLastCalledWith({
      retryAt: nextRetryAt('not_found', 3, NOW),
    });
  });

  it('id_mismatch waits the full 24 h', async () => {
    const { mock, db } = setup();
    mock.returning.mockResolvedValueOnce([{ failures: 1 }]);
    await recordMemberFailure(db, 9, 'id_mismatch', NOW);
    expect(mock.set).toHaveBeenLastCalledWith({
      retryAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
    });
  });
});

describe('applySnapshotToCharacter', () => {
  it('copies the snapshot with a compare-and-set on game_variant IS NULL', async () => {
    const { mock, db } = setup();
    mock.returning.mockResolvedValueOnce([{ id: 'c1' }]);
    expect(await applySnapshotToCharacter(db, 'c1', SNAPSHOT)).toBe(true);
    expect(mock.update).toHaveBeenCalledWith(schema.characters);
    expect(mock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: '12345',
        gameVariant: 'wow_forever',
        lastSyncedAt: SYNCED,
        itemLevel: 51,
      }),
    );
    expect(render(firstArg(mock.where))).toContain('"game_variant" is null');
  });

  it('is a no-op (false) when the row is already Armory-linked', async () => {
    const { mock, db } = setup();
    mock.returning.mockResolvedValueOnce([]);
    expect(await applySnapshotToCharacter(db, 'c1', SNAPSHOT)).toBe(false);
  });

  it('never writes an unsynced snapshot', async () => {
    const { mock, db } = setup();
    const unsynced = { ...SNAPSHOT, syncedAt: null };
    expect(await applySnapshotToCharacter(db, 'c1', unsynced)).toBe(false);
    expect(mock.update).not.toHaveBeenCalled();
  });
});

describe('memberOwnedByCharacterSync', () => {
  it('matches a Forever-linked character holding the member Blizzard id', () => {
    const query = dialect.sqlToQuery(memberOwnedByCharacterSync());
    const text = query.sql;
    expect(text).toContain('exists');
    expect(text).toContain('oc.game_variant = $1');
    expect(query.params).toEqual(['wow_forever']);
    expect(text).toContain(
      'external_id = "guild_members"."blizzard_character_id"::text',
    );
  });
});
