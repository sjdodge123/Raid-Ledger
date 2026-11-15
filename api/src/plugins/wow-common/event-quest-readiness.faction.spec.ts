import type { DungeonQuestDto } from './dungeon-quests.types';
import { selectEventQuests } from './event-forever-progress.helpers';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import { factionOfRace } from './quest-faction.helpers';

const ALLIANCE = ['Human', 'Dwarf', 'Night Elf', 'Gnome'];
const HORDE = ['Orc', 'Undead', 'Tauren', 'Troll'];

const quest = (
  questId: number,
  name: string,
  raceRestriction: string[] | null,
): DungeonQuestDto =>
  ({
    questId,
    name,
    dungeonInstanceId: 43,
    prevQuestId: null,
    nextQuestId: null,
    classRestriction: null,
    raceRestriction,
  }) as unknown as DungeonQuestDto;

/** A dungeon with Alliance-only, Horde-only, neutral and same-name variants. */
const KNOWN = [
  quest(600, 'Alliance Only', ALLIANCE),
  quest(500, 'Horde Only', HORDE),
  quest(200, 'Neutral Empty', []),
  quest(300, 'Neutral Null', null),
  quest(700, 'Shared', ALLIANCE),
  quest(701, 'Shared', HORDE),
  quest(800, 'Split', ['Undead']),
  quest(801, 'Split', ['Orc', 'Tauren', 'Troll']),
];
const BY_ID = new Map(KNOWN.map((q) => [q.questId, q]));
const SET = selectEventQuests(KNOWN, [43]);
const AT = new Date('2026-11-15T12:00:00.000Z');
const C1 = '11111111-1111-4111-8111-111111111111';

const signup = (
  userId: number,
  charRace: string | null,
  charFaction: string | null,
  characterId: string | null = null,
): ReadinessSignup => ({
  userId,
  username: `u${userId}`,
  characterId,
  characterName: null,
  charClass: null,
  charRace,
  charFaction,
});

const snap = (completed: number[]): EffectiveQuests => ({
  quests: { completed, inProgress: [] },
  capturedAt: AT,
  source: 'addon',
  inProgressAsOf: AT,
});

const build = (signups: ReadinessSignup[], snaps = new Map()) =>
  buildQuestReadiness({ quests: SET, signups, snapshots: snaps, manual: [] });

const columnIds = (body: ReturnType<typeof build>) =>
  body.quests.map((q) => q.questId).sort((a, b) => a - b);

/** Columns whose quest only Alliance races can take. */
const allianceOnly = (body: ReturnType<typeof build>) =>
  body.quests.filter((c) => {
    const races = BY_ID.get(c.questId)?.raceRestriction ?? [];
    return (
      races.length > 0 && races.every((r) => factionOfRace(r) === 'alliance')
    );
  });

describe('buildQuestReadiness faction filter (ROK-2211)', () => {
  // An Orc plus a raceless character whose faction column says Horde.
  const HORDE_ROSTER = [signup(1, 'Orc', null, C1), signup(2, null, 'Horde')];

  it('a Horde-only roster has no Alliance-only quest column', () => {
    expect(allianceOnly(build(HORDE_ROSTER))).toEqual([]);
  });

  it('keeps neutral quests and collapses faction variants to one column', () => {
    expect(columnIds(build(HORDE_ROSTER))).toEqual([200, 300, 500, 701, 800]);
  });

  it("reports a variant's progress under its column's quest id", () => {
    const body = build(HORDE_ROSTER, new Map([[C1, snap([801])]]));
    const orc = body.signups.find((s) => s.userId === 1);
    expect(orc?.perQuest.find((p) => p.questId === 800)?.state).toBe('done');
    expect(orc?.perQuest.some((p) => p.questId === 801)).toBe(false);
  });

  it('a raceless signup with a Horde faction column gets no Alliance cells', () => {
    const row = build(HORDE_ROSTER).signups.find((s) => s.userId === 2);
    expect(row?.perQuest.map((p) => p.questId)).not.toContain(600);
  });

  it('a mixed or all-unknown roster keeps every quest (pre-2211)', () => {
    const all = KNOWN.map((q) => q.questId).sort((a, b) => a - b);
    expect(
      columnIds(build([signup(1, 'Orc', null), signup(2, 'Human', null)])),
    ).toEqual(all);
    expect(columnIds(build([signup(1, null, null)]))).toEqual(all);
  });
});
