/**
 * ROK-2133: pure rules for the roster Armory snapshot — due members
 * (AC-7), failure backoff (AC-3/AC-4), id verification (AC-4) and the
 * claim-time column copy (AC-9 mapping).
 */
import {
  MAX_MEMBERS_PER_RUN,
  MIN_LEVEL,
  RESYNC_AFTER_MS,
  isMemberDue,
  isSnapshotVerified,
  nextRetryAt,
  snapshotToCharacterColumns,
  stopsRosterArmoryRun,
  type MemberArmorySnapshot,
  type MemberDueState,
} from './snapshot.helpers';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-11-08T12:00:00.000Z');

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function state(over: Partial<MemberDueState> = {}): MemberDueState {
  return { level: 40, syncedAt: ago(HOUR), retryAt: null, ...over };
}

describe('constants', () => {
  it('pins the run cap, resync age and level floor', () => {
    expect(MAX_MEMBERS_PER_RUN).toBe(150);
    expect(RESYNC_AFTER_MS).toBe(24 * HOUR);
    expect(MIN_LEVEL).toBe(10);
  });
});

describe('isMemberDue', () => {
  it('is due when the member was never synced (no snapshot row)', () => {
    expect(isMemberDue({ snapshot: null, rosterLevel: 40, now: NOW })).toBe(
      true,
    );
  });

  it('is due when a snapshot row exists but never succeeded', () => {
    const snapshot = state({ syncedAt: null, level: null });
    expect(isMemberDue({ snapshot, rosterLevel: 40, now: NOW })).toBe(true);
  });

  it('is NOT due when synced < 24 h ago at the same level', () => {
    const snapshot = state({ syncedAt: ago(23 * HOUR) });
    expect(isMemberDue({ snapshot, rosterLevel: 40, now: NOW })).toBe(false);
  });

  it('is due once synced_at is older than 24 h', () => {
    const snapshot = state({ syncedAt: ago(24 * HOUR + 1) });
    expect(isMemberDue({ snapshot, rosterLevel: 40, now: NOW })).toBe(true);
  });

  it('is due when the roster level differs from the snapshot (a ding)', () => {
    const snapshot = state({ level: 40 });
    expect(isMemberDue({ snapshot, rosterLevel: 41, now: NOW })).toBe(true);
  });

  it('is never due below level 10 or with an unknown roster level', () => {
    expect(isMemberDue({ snapshot: null, rosterLevel: 9, now: NOW })).toBe(
      false,
    );
    expect(isMemberDue({ snapshot: null, rosterLevel: null, now: NOW })).toBe(
      false,
    );
  });

  it('waits for retry_at even when otherwise due', () => {
    const snapshot = state({
      syncedAt: null,
      retryAt: new Date(NOW.getTime() + 1),
    });
    expect(isMemberDue({ snapshot, rosterLevel: 40, now: NOW })).toBe(false);
  });

  it('is due again once retry_at has elapsed', () => {
    const snapshot = state({ syncedAt: null, retryAt: NOW });
    expect(isMemberDue({ snapshot, rosterLevel: 40, now: NOW })).toBe(true);
  });
});

describe('nextRetryAt', () => {
  const delay = (d: Date): number => d.getTime() - NOW.getTime();

  it('follows the 1 h doubling curve for not_found / upstream', () => {
    expect(delay(nextRetryAt('not_found', 1, NOW))).toBe(HOUR);
    expect(delay(nextRetryAt('not_found', 2, NOW))).toBe(2 * HOUR);
    expect(delay(nextRetryAt('upstream', 3, NOW))).toBe(4 * HOUR);
    expect(delay(nextRetryAt('upstream', 5, NOW))).toBe(16 * HOUR);
  });

  it('caps the curve at 24 h', () => {
    expect(delay(nextRetryAt('not_found', 6, NOW))).toBe(24 * HOUR);
    expect(delay(nextRetryAt('upstream', 50, NOW))).toBe(24 * HOUR);
  });

  it('waits the full 24 h for invalid_name and id_mismatch on the first failure', () => {
    expect(delay(nextRetryAt('invalid_name', 1, NOW))).toBe(24 * HOUR);
    expect(delay(nextRetryAt('id_mismatch', 1, NOW))).toBe(24 * HOUR);
  });
});

describe('stopsRosterArmoryRun', () => {
  it('stops the run only on an upstream error', () => {
    expect(stopsRosterArmoryRun('upstream')).toBe(true);
    expect(stopsRosterArmoryRun('not_found')).toBe(false);
    expect(stopsRosterArmoryRun('id_mismatch')).toBe(false);
    expect(stopsRosterArmoryRun('invalid_name')).toBe(false);
  });
});

describe('isSnapshotVerified', () => {
  it('accepts a fetched id equal to the roster id (string or number)', () => {
    expect(isSnapshotVerified('123456', 123456)).toBe(true);
    expect(isSnapshotVerified(123456, 123456)).toBe(true);
  });

  it('rejects a different id (renamed / recycled name)', () => {
    expect(isSnapshotVerified('999', 123456)).toBe(false);
  });

  it('rejects when either id is missing', () => {
    expect(isSnapshotVerified(null, 123456)).toBe(false);
    expect(isSnapshotVerified('123456', null)).toBe(false);
    expect(isSnapshotVerified('', 0)).toBe(false);
  });
});

describe('snapshotToCharacterColumns', () => {
  const snapshot: MemberArmorySnapshot = {
    blizzardCharacterId: 123456,
    level: 42,
    class: 'Mage',
    race: 'Gnome',
    spec: 'Frost',
    role: 'dps',
    itemLevel: 51,
    avatarUrl: 'https://render.example/avatar.jpg',
    equipment: { items: [{ slot: 'HEAD' }] },
    talents: { specs: [] },
    armoryProfessions: [{ name: 'Tailoring', skill: 150 }],
    lastLoginAt: ago(2 * HOUR),
    syncedAt: ago(HOUR),
  };

  it('maps every snapshot column onto the characters columns', () => {
    expect(snapshotToCharacterColumns(snapshot)).toEqual({
      level: 42,
      class: 'Mage',
      race: 'Gnome',
      spec: 'Frost',
      role: 'dps',
      itemLevel: 51,
      avatarUrl: 'https://render.example/avatar.jpg',
      equipment: { items: [{ slot: 'HEAD' }] },
      talents: { specs: [] },
      armoryProfessions: [{ name: 'Tailoring', skill: 150 }],
      externalId: '123456',
      gameVariant: 'wow_forever',
      lastSyncedAt: ago(HOUR),
    });
  });

  it('returns null for an unverified or never-synced snapshot', () => {
    expect(
      snapshotToCharacterColumns({ ...snapshot, blizzardCharacterId: null }),
    ).toBeNull();
    expect(
      snapshotToCharacterColumns({ ...snapshot, syncedAt: null }),
    ).toBeNull();
  });
});
