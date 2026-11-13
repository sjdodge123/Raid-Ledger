import {
  GUILD_ACTIVITY_MAX,
  GUILD_ACTIVITY_NAMES_MAX,
  WowGuildActivityEntrySchema,
  type WowGuildActivityEntryDto,
  type WowProgressionInstanceDto,
} from '@raid-ledger/contract';
import {
  activityWindowStart,
  addMonthsUtc,
  dingEntries,
  eventEntries,
  firstKillEntries,
  isFirstBatch,
  joinEntries,
  mergeActivity,
  milestoneEntries,
  type ActivityMemberRow,
} from './activity.helpers';

const MIN = 60_000;
const DAY = 86_400_000;
const NOW = new Date('2026-11-13T12:00:00.000Z');
const SINCE = activityWindowStart(NOW);
const GUILD_AT = new Date('2026-09-01T00:00:00.000Z');

function must<T>(v: T | undefined, label: string): T {
  if (v === undefined) throw new Error(`missing ${label}`);
  return v;
}

function member(
  memberId: number,
  createdAt: Date,
  over: Partial<ActivityMemberRow> = {},
): ActivityMemberRow {
  return {
    memberId,
    characterName: `Char${String(memberId).padStart(3, '0')}`,
    characterId: null,
    className: 'Mage',
    createdAt,
    guildCreatedAt: GUILD_AT,
    ...over,
  };
}

function expectValid(entries: WowGuildActivityEntryDto[]): void {
  for (const e of entries)
    expect(WowGuildActivityEntrySchema.safeParse(e).success).toBe(true);
}

describe('activityWindowStart', () => {
  it('is 30 days before now', () => {
    expect(NOW.getTime() - SINCE.getTime()).toBe(30 * DAY);
  });
});

describe('isFirstBatch (B6)', () => {
  it('hides a member created with the guild and up to 10 minutes later', () => {
    expect(isFirstBatch(GUILD_AT, GUILD_AT)).toBe(true);
    expect(isFirstBatch(new Date(GUILD_AT.getTime() + 9 * MIN), GUILD_AT)).toBe(
      true,
    );
  });
  it('shows a member created 11 minutes after the guild', () => {
    expect(
      isFirstBatch(new Date(GUILD_AT.getTime() + 11 * MIN), GUILD_AT),
    ).toBe(false);
  });
});

describe('joinEntries', () => {
  const recent = new Date(NOW.getTime() - 5 * DAY);

  it('emits a new_member row per later join, hiding the first batch', () => {
    const guildNow = new Date(NOW.getTime() - 20 * DAY);
    const rows = [
      member(1, guildNow, { guildCreatedAt: guildNow }),
      member(2, recent, {
        guildCreatedAt: guildNow,
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
    ];
    const out = joinEntries(rows);
    expect(out).toEqual([
      {
        kind: 'new_member',
        id: 'join:2',
        at: recent.toISOString(),
        characterName: 'Char002',
        characterId: '00000000-0000-4000-8000-000000000001',
        className: 'Mage',
      },
    ]);
    expectValid(out);
  });

  it('dedupes a member joined to two characters (first row wins)', () => {
    const rows = [
      member(2, recent, {
        characterId: '00000000-0000-4000-8000-000000000001',
      }),
      member(2, recent, {
        characterId: '00000000-0000-4000-8000-000000000002',
      }),
    ];
    expect(joinEntries(rows).map((e) => e.id)).toEqual(['join:2']);
  });
});

describe('joinEntries — roster imports (Q-B14)', () => {
  const recent = new Date(NOW.getTime() - 5 * DAY);

  it('collapses 10+ joins sharing one created_at into one roster_import (Q-B14)', () => {
    const rows = Array.from({ length: 25 }, (_, i) => member(25 - i, recent));
    const out = joinEntries([
      ...rows,
      member(99, new Date(recent.getTime() + 1)),
    ]);
    const imp = must(
      out.find((e) => e.kind === 'roster_import'),
      'import',
    );
    expect(imp).toEqual({
      kind: 'roster_import',
      id: `import:${recent.toISOString()}`,
      at: recent.toISOString(),
      count: 25,
      names: Array.from(
        { length: GUILD_ACTIVITY_NAMES_MAX },
        (_, i) => `Char${String(i + 1).padStart(3, '0')}`,
      ),
    });
    expect(out.filter((e) => e.kind === 'new_member').map((e) => e.id)).toEqual(
      ['join:99'],
    );
    expectValid(out);
  });

  it('collapses exactly 10 same-timestamp joins', () => {
    const rows = Array.from({ length: 10 }, (_, i) => member(i + 1, recent));
    expect(joinEntries(rows).map((e) => e.kind)).toEqual(['roster_import']);
  });

  it('keeps 9 same-timestamp joins as individual rows', () => {
    const rows = Array.from({ length: 9 }, (_, i) => member(i + 1, recent));
    const out = joinEntries(rows);
    expect(out).toHaveLength(9);
    expect(out.every((e) => e.kind === 'new_member')).toBe(true);
  });
});

describe('addMonthsUtc', () => {
  it('clamps Jan 31 + 1 month to the last day of February', () => {
    expect(
      addMonthsUtc(new Date('2026-01-31T08:30:00.000Z'), 1).toISOString(),
    ).toBe('2026-02-28T08:30:00.000Z');
    expect(
      addMonthsUtc(new Date('2028-01-31T08:30:00.000Z'), 1).toISOString(),
    ).toBe('2028-02-29T08:30:00.000Z');
  });
  it('crosses a year boundary', () => {
    expect(
      addMonthsUtc(new Date('2026-08-15T00:00:00.000Z'), 6).toISOString(),
    ).toBe('2027-02-15T00:00:00.000Z');
    expect(
      addMonthsUtc(new Date('2025-11-01T00:00:00.000Z'), 12).toISOString(),
    ).toBe('2026-11-01T00:00:00.000Z');
  });
});

describe('milestoneEntries (B8)', () => {
  it('emits a 1-month milestone that falls inside the window', () => {
    const created = new Date('2026-10-11T10:00:00.000Z');
    const out = milestoneEntries([member(7, created)], SINCE, NOW);
    expect(out).toEqual([
      {
        kind: 'milestone',
        id: 'ms:7:1',
        at: '2026-11-11T10:00:00.000Z',
        characterName: 'Char007',
        characterId: null,
        months: 1,
        count: 1,
        names: ['Char007'],
      },
    ]);
    expectValid(out);
  });

  it('emits 6- and 12-month milestones', () => {
    const six = member(1, new Date('2026-05-10T00:00:00.000Z'));
    const twelve = member(2, new Date('2025-11-01T00:00:00.000Z'));
    const ids = milestoneEntries([six, twelve], SINCE, NOW)
      .map((e) => e.id)
      .sort();
    expect(ids).toEqual(['ms:1:6', 'ms:2:12']);
  });

  it('excludes anniversaries before the window and in the future', () => {
    const old = member(1, new Date('2026-09-01T00:00:00.000Z'));
    const future = member(2, new Date('2026-10-14T00:00:00.000Z'));
    expect(milestoneEntries([old, future], SINCE, NOW)).toEqual([]);
  });
});

describe('milestoneEntries — grouping (Q-B13)', () => {
  it('groups 4+ same-day same-months milestones into one row (Q-B13)', () => {
    const day = '2026-10-05T';
    const rows = [4, 2, 3, 1].map((id, i) =>
      member(id, new Date(`${day}0${i}:00:00.000Z`)),
    );
    const out = milestoneEntries(
      [...rows, member(9, new Date('2026-10-06T00:00:00.000Z'))],
      SINCE,
      NOW,
    );
    const grouped = must(
      out.find((e) => e.id === 'ms:2026-11-05:1'),
      'grouped',
    );
    expect(grouped).toEqual({
      kind: 'milestone',
      id: 'ms:2026-11-05:1',
      at: '2026-11-05T03:00:00.000Z',
      characterName: 'Char001',
      characterId: null,
      months: 1,
      count: 4,
      names: ['Char001', 'Char002', 'Char003', 'Char004'],
    });
    expect(out.map((e) => e.id).sort()).toEqual(['ms:2026-11-05:1', 'ms:9:1']);
  });

  it('keeps 3 same-day milestones as individual rows', () => {
    const rows = [1, 2, 3].map((id) =>
      member(id, new Date('2026-10-05T00:00:00.000Z')),
    );
    expect(
      milestoneEntries(rows, SINCE, NOW)
        .map((e) => e.id)
        .sort(),
    ).toEqual(['ms:1:1', 'ms:2:1', 'ms:3:1']);
  });
});

function boss(
  encounterId: number,
  difficultyId: number,
  firstKillAt: string | null,
): WowProgressionInstanceDto['bosses'][number] {
  return {
    encounterId,
    difficultyId,
    difficultyLabel: '40',
    name: `Boss ${encounterId}`,
    firstKillAt,
    kills: firstKillAt === null ? 0 : 1,
    wipes: 0,
    lastPullAt: '2026-11-01T00:00:00.000Z',
    order: null,
  };
}

function instance(
  key: string,
  bosses: WowProgressionInstanceDto['bosses'],
): WowProgressionInstanceDto {
  return {
    key,
    name: key === 'other' ? 'Other bosses' : 'Molten Core',
    bossesDown: 0,
    bossTotal: null,
    showDifficulty: false,
    latestKill: null,
    bosses,
  };
}

describe('firstKillEntries', () => {
  it('emits first kills inside the window only, per (encounter, difficulty)', () => {
    const inst = instance('j:741', [
      boss(663, 9, '2026-11-01T20:00:00.000Z'),
      boss(663, 3, '2026-11-02T20:00:00.000Z'),
      boss(664, 9, '2026-09-01T20:00:00.000Z'),
      boss(665, 9, null),
    ]);
    const out = firstKillEntries([inst], SINCE, NOW);
    expect(out.map((e) => e.id)).toEqual(['kill:663:9', 'kill:663:3']);
    expect(out[0]).toEqual({
      kind: 'first_kill',
      id: 'kill:663:9',
      at: '2026-11-01T20:00:00.000Z',
      bossName: 'Boss 663',
      difficultyLabel: '40',
      instanceName: 'Molten Core',
    });
    expectValid(out);
  });

  it('gives the Other bosses bucket a null instance name', () => {
    const out = firstKillEntries(
      [instance('other', [boss(1, 1, '2026-11-01T00:00:00.000Z')])],
      SINCE,
      NOW,
    );
    expect(out[0]?.kind === 'first_kill' && out[0].instanceName).toBeNull();
  });
});

describe('eventEntries / dingEntries', () => {
  it('maps ended events, truncating long titles to 200 characters', () => {
    const endedAt = new Date('2026-11-10T22:00:00.000Z');
    const out = eventEntries([{ id: 5, title: 'x'.repeat(250), endedAt }]);
    expect(out).toEqual([
      {
        kind: 'event',
        id: 'event:5',
        at: endedAt.toISOString(),
        eventId: 5,
        title: 'x'.repeat(200),
      },
    ]);
    expectValid(out);
  });

  it('maps dings, one per event row id', () => {
    const occurredAt = new Date('2026-11-12T01:00:00.000Z');
    const row = {
      id: 3,
      name: 'Thalia',
      characterId: null,
      fromLevel: 59,
      toLevel: 60,
      occurredAt,
    };
    const out = dingEntries([
      row,
      { ...row, characterId: '00000000-0000-4000-8000-000000000001' },
    ]);
    expect(out).toEqual([
      {
        kind: 'ding',
        id: 'ding:3',
        at: occurredAt.toISOString(),
        characterName: 'Thalia',
        characterId: null,
        toLevel: 60,
      },
    ]);
    expectValid(out);
  });
});

describe('mergeActivity', () => {
  const ev = (id: number, at: string): WowGuildActivityEntryDto => ({
    kind: 'event',
    id: `event:${id}`,
    at,
    eventId: id,
    title: 't',
  });

  it('sorts newest first, then by id, and drops duplicate ids', () => {
    const a = ev(2, '2026-11-01T00:00:00.000Z');
    const b = ev(1, '2026-11-01T00:00:00.000Z');
    const c = ev(3, '2026-11-05T00:00:00.000Z');
    expect(
      mergeActivity([
        [a, c],
        [b, a],
      ]).map((e) => e.id),
    ).toEqual(['event:3', 'event:1', 'event:2']);
  });

  it(`caps at ${GUILD_ACTIVITY_MAX}, keeping the newest`, () => {
    const many = Array.from({ length: GUILD_ACTIVITY_MAX + 5 }, (_, i) =>
      ev(i + 1, new Date(NOW.getTime() - i * MIN).toISOString()),
    );
    const out = mergeActivity([many]);
    expect(out).toHaveLength(GUILD_ACTIVITY_MAX);
    expect(out[0]?.id).toBe('event:1');
    expect(out[GUILD_ACTIVITY_MAX - 1]?.id).toBe(`event:${GUILD_ACTIVITY_MAX}`);
  });
});
