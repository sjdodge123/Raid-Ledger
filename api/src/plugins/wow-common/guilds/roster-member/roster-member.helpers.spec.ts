/**
 * ROK-2149 — the roster-member page's pure rules: audience selection, the
 * verified-snapshot rule (AC-4), D1 reason precedence (AC-5) and the
 * audience-2 field omission.
 */
import {
  isVerifiedSnapshot,
  noArmoryReason,
  selectAudience,
  type SnapshotState,
} from './roster-member.helpers';
import { toRosterMemberCharacter } from './roster-member.mapper';
import type {
  RosterMemberRow,
  RosterMemberSnapshot,
} from './roster-member.queries';

const SYNCED = new Date('2026-11-08T00:00:00Z');
const snap = (over: Partial<SnapshotState> = {}): SnapshotState => ({
  blizzardCharacterId: 9,
  syncedAt: SYNCED,
  lastError: null,
  ...over,
});

describe('selectAudience', () => {
  it('members + staff always get the member audience', () => {
    expect(
      selectAudience({ canView: true, unclaimed: false, claimable: false }),
    ).toBe('member');
  });
  it('a non-member previews only an unclaimed member of a claimable guild', () => {
    expect(
      selectAudience({ canView: false, unclaimed: true, claimable: true }),
    ).toBe('claim_preview');
    expect(
      selectAudience({ canView: false, unclaimed: false, claimable: true }),
    ).toBe('forbidden');
    expect(
      selectAudience({ canView: false, unclaimed: true, claimable: false }),
    ).toBe('forbidden');
  });
});

describe('isVerifiedSnapshot (AC-4)', () => {
  it('matches only the member current Blizzard id, synced', () => {
    expect(isVerifiedSnapshot(9, snap())).toBe(true);
    expect(isVerifiedSnapshot(10, snap())).toBe(false);
    expect(isVerifiedSnapshot(null, snap())).toBe(false);
    expect(isVerifiedSnapshot(9, snap({ syncedAt: null }))).toBe(false);
    expect(isVerifiedSnapshot(9, null)).toBe(false);
  });
});

describe('noArmoryReason (D1, AC-5)', () => {
  const reason = (
    memberBlizzardId: number | null,
    rosterLevel: number | null,
    snapshot: SnapshotState | null,
  ) => noArmoryReason({ memberBlizzardId, rosterLevel, snapshot });

  it('a verified snapshot wins over last_error', () => {
    expect(reason(9, 30, snap({ lastError: 'not_found' }))).toBeUndefined();
  });
  it('returns each reason for its condition, in table order', () => {
    expect(reason(null, 5, null)).toBe('no_blizzard_id');
    expect(reason(9, 9, null)).toBe('below_level_10');
    expect(reason(9, 30, snap({ syncedAt: null, lastError: 'invalid_name' }))).toBe(
      'invalid_name',
    );
    expect(reason(9, 30, snap({ syncedAt: null, lastError: 'not_found' }))).toBe(
      'not_found',
    );
    expect(reason(10, 30, snap({ lastError: 'id_mismatch' }))).toBe(
      'id_mismatch',
    );
    expect(reason(9, 30, null)).toBe('pending');
  });
  it('an unverified snapshot without an error, or upstream, is pending', () => {
    expect(reason(10, 30, snap())).toBe('pending');
    expect(reason(9, 30, snap({ syncedAt: null, lastError: 'upstream' }))).toBe(
      'pending',
    );
  });
});

const armory = (over: Partial<RosterMemberSnapshot> = {}): RosterMemberSnapshot => ({
  blizzardCharacterId: 9,
  level: 40,
  class: 'Mage',
  race: 'Gnome',
  spec: 'Frost',
  role: 'dps',
  itemLevel: 51,
  avatarUrl: 'https://render.example/avatar.jpg',
  equipment: null,
  talents: { spec: 'Frost' },
  armoryProfessions: null,
  syncedAt: SYNCED,
  lastError: null,
  ...over,
});

const row = (over: Partial<RosterMemberRow> = {}): RosterMemberRow => ({
  memberId: 42,
  guildId: 7,
  gameId: 3,
  region: 'us',
  name: 'Fizzle',
  level: 40,
  class: 'Mage',
  rankIndex: 2,
  rankName: 'Officer',
  onlineAtExport: false,
  lastOnlineDays: 3,
  blizzardCharacterId: 9,
  createdAt: SYNCED,
  updatedAt: SYNCED,
  claimedCharacterId: null,
  unclaimed: true,
  snapshot: armory(),
  ...over,
});

describe('toRosterMemberCharacter', () => {
  it('members audience: snapshot fields, rank and lastSeen, synthetic id', () => {
    const dto = toRosterMemberCharacter(row(), {
      includeRoster: true,
      canClaim: true,
    });
    expect(dto).toMatchObject({
      id: 'roster-member:42',
      userId: null,
      readOnly: true,
      race: 'Gnome',
      spec: 'Frost',
      itemLevel: 51,
      gameVariant: 'wow_forever',
      rank: { index: 2, name: 'Officer' },
      lastSeen: { online: false, lastOnlineDays: 3 },
    });
    expect('noArmoryReason' in dto).toBe(false);
  });
  it('claim preview: the rank and lastSeen keys are absent, not null', () => {
    const dto = toRosterMemberCharacter(row(), {
      includeRoster: false,
      canClaim: true,
    });
    expect(Object.keys(dto)).not.toContain('rank');
    expect(Object.keys(dto)).not.toContain('lastSeen');
  });
  it('an id-mismatched snapshot is not returned (AC-4)', () => {
    const dto = toRosterMemberCharacter(
      row({ snapshot: armory({ blizzardCharacterId: 8, lastError: 'id_mismatch' }) }),
      { includeRoster: true, canClaim: false },
    );
    expect(dto.race).toBeNull();
    expect(dto.talents).toBeNull();
    expect(dto.noArmoryReason).toBe('id_mismatch');
  });
});
