/**
 * ROK-2133 AC-12 (unit) — members list + pick list DTOs carry Armory
 * itemLevel/spec/role when present and omit the keys otherwise. The
 * character-vs-snapshot coalesce is SQL, proven in
 * blizzard-forever.member-facts.integration.spec.ts.
 */
import { armoryDtoFields } from './roster-armory-fields';
import { groupRoster, type RawRosterRow } from './guild-roster.helpers';
import { groupByGuild } from './roster-claim/roster-claim.service';
import type { CandidateRow } from './roster-claim/roster-claim.queries';

const rosterRow = (over: Partial<RawRosterRow>): RawRosterRow => ({
  memberId: 1,
  name: 'Anna',
  class: 'Priest',
  level: 60,
  rankIndex: 2,
  rankName: 'Raider',
  characterId: null,
  userId: null,
  role: null,
  roleOverride: null,
  isMain: null,
  onlineAtExport: null,
  lastOnlineDays: null,
  ...over,
});

const candidate = (over: Partial<CandidateRow>): CandidateRow => ({
  guildId: 3,
  guildName: 'Forever Guild',
  region: 'us',
  memberId: 1,
  name: 'Anna',
  class: 'Priest',
  level: 60,
  source: 'blizzard',
  ...over,
});

const ARMORY = {
  armoryItemLevel: 51,
  armorySpec: 'Holy',
  armoryRole: 'healer',
};

describe('armoryDtoFields', () => {
  it('maps all three when present', () => {
    expect(armoryDtoFields(ARMORY)).toEqual({
      itemLevel: 51,
      spec: 'Holy',
      role: 'healer',
    });
  });

  it('omits each key that is null, missing, or outside the contract', () => {
    expect(armoryDtoFields({})).toEqual({});
    expect(
      armoryDtoFields({
        armoryItemLevel: null,
        armorySpec: null,
        armoryRole: null,
      }),
    ).toEqual({});
    expect(
      armoryDtoFields({
        armoryItemLevel: -1,
        armorySpec: '',
        armoryRole: 'bard',
      }),
    ).toEqual({});
  });
});

describe('members list DTO (AC-12)', () => {
  it('carries the Armory fields of a member that has them', () => {
    const [group] = groupRoster([rosterRow(ARMORY)]);
    expect(group?.members[0]).toMatchObject({
      itemLevel: 51,
      spec: 'Holy',
      role: 'healer',
      effectiveRole: null,
    });
  });

  it('omits the keys for a member without them', () => {
    const [group] = groupRoster([rosterRow({})]);
    const keys = Object.keys(group?.members[0] ?? { missing: true });
    for (const k of ['itemLevel', 'spec', 'role'])
      expect(keys).not.toContain(k);
  });
});

describe('pick list DTO (AC-12)', () => {
  it('carries the Armory fields of a candidate that has them', () => {
    const [guild] = groupByGuild([candidate(ARMORY)]);
    expect(guild?.candidates[0]).toEqual({
      memberId: 1,
      name: 'Anna',
      class: 'Priest',
      level: 60,
      source: 'blizzard',
      itemLevel: 51,
      spec: 'Holy',
      role: 'healer',
    });
  });

  it('omits the keys for a candidate without them', () => {
    const [guild] = groupByGuild([candidate({})]);
    expect(guild?.candidates[0]).toEqual({
      memberId: 1,
      name: 'Anna',
      class: 'Priest',
      level: 60,
      source: 'blizzard',
    });
  });
});
