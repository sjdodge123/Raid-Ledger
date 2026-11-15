import type { DungeonQuestDto } from './dungeon-quests.types';
import { selectEventQuests } from './event-forever-progress.helpers';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import type { ManualProgressRow } from './quest-progress-addon.helpers';
import { questEvidence } from './event-raid-readiness.evidence';
import { factionOfRace } from './quest-faction.helpers';

const ALLIANCE = ['Human', 'Dwarf', 'Night Elf', 'Gnome'];
const HORDE = ['Orc', 'Undead', 'Tauren', 'Troll'];

const quest = (
  questId: number,
  name: string,
  raceRestriction: string[] | null,
  prevQuestId: number | null = null,
  nextQuestId: number | null = null,
): DungeonQuestDto =>
  ({
    questId,
    name,
    dungeonInstanceId: 43,
    prevQuestId,
    nextQuestId,
    classRestriction: null,
    raceRestriction,
  }) as unknown as DungeonQuestDto;

const TORMENT = [97288, 97289, 97291, 97292];

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
  // A generic quest and its Alliance-only same-name variant.
  quest(7068, 'Shadowshard Fragments', null),
  quest(7070, 'Shadowshard Fragments', ALLIANCE),
  // A Horde chain whose four steps share one name.
  quest(97288, 'Unending Torment', HORDE, null, 97289),
  quest(97289, 'Unending Torment', HORDE, 97288, 97291),
  quest(97291, 'Unending Torment', HORDE, 97289, 97292),
  quest(97292, 'Unending Torment', HORDE, 97291, null),
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

const manualRow = (userId: number, questId: number): ManualProgressRow => ({
  id: 1,
  userId,
  questId,
  pickedUp: false,
  completed: true,
  updatedAt: AT,
});

const build = (
  signups: ReadinessSignup[],
  snaps = new Map<string, EffectiveQuests>(),
  manual: ManualProgressRow[] = [],
) => buildQuestReadiness({ quests: SET, signups, snapshots: snaps, manual });

const cell = (body: ReturnType<typeof build>, userId: number, id: number) =>
  body.signups
    .find((s) => s.userId === userId)
    ?.perQuest.find((p) => p.questId === id);

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

  it('keeps neutral quests and every own-side variant, one column each', () => {
    expect(columnIds(build(HORDE_ROSTER))).toEqual([
      200,
      300,
      500,
      701,
      800,
      801,
      7068,
      ...TORMENT,
    ]);
  });

  it('keeps every step of a same-name Horde chain as its own column', () => {
    const body = build(HORDE_ROSTER);
    const steps = body.quests.filter((q) => q.title === 'Unending Torment');
    expect(steps.map((q) => q.questId)).toEqual(TORMENT);
  });

  it('an Alliance roster that completed 7070 sees it done under 7070', () => {
    const body = build(
      [signup(1, 'Human', null, C1)],
      new Map([[C1, snap([7070])]]),
    );
    expect(cell(body, 1, 7070)?.state).toBe('done');
    expect(cell(body, 1, 7068)?.state).toBe('missing');
  });

  it("keys each cell by the variant's own quest id", () => {
    const body = build(HORDE_ROSTER, new Map([[C1, snap([801])]]));
    expect(cell(body, 1, 801)?.state).toBe('done');
    // An Orc cannot take the Undead-only 800, so it gets no cell there.
    expect(cell(body, 1, 800)).toBeUndefined();
  });

  it("finds a manual progress row on a variant as the signup's evidence", () => {
    const manual = [manualRow(1, 801)];
    const body = build(HORDE_ROSTER, new Map(), manual);
    const row = body.signups.find((s) => s.userId === 1);
    expect(cell(body, 1, 801)?.source).toBe('manual');
    expect(questEvidence(row, new Map(), manual)).toEqual([
      { source: 'manual', asOf: AT },
    ]);
  });

  it('a raceless Horde-column signup gets no Alliance cells in a mixed roster', () => {
    // Human + raceless Horde: sides unknown-or-mixed, so every column stays.
    const body = build([signup(1, 'Human', null), signup(2, null, 'Horde')]);
    expect(body.quests.map((q) => q.questId)).toContain(600);
    const row = body.signups.find((s) => s.userId === 2);
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
