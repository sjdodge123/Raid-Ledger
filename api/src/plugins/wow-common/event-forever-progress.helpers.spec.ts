import {
  buildMembers,
  buildViewerPrereqs,
  contentInstanceIds,
  selectEventQuests,
  type ForeverMember,
} from './event-forever-progress.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';

const quest = (
  questId: number,
  instance: number | null,
  prev: number | null = null,
): DungeonQuestDto =>
  ({
    questId,
    name: `Q${questId}`,
    dungeonInstanceId: instance,
    prevQuestId: prev,
    nextQuestId: null,
  }) as unknown as DungeonQuestDto;

describe('contentInstanceIds', () => {
  it('accepts numeric-string ids and the legacy instanceId key like the web panels', () => {
    expect(
      contentInstanceIds([
        { id: '63' },
        { instanceId: 36 },
        { id: 'abc' },
        { id: 0 },
        { id: -1 },
      ]),
    ).toEqual([63, 36]);
  });

  it('reads integer ids from [{id}] and ignores junk', () => {
    expect(contentInstanceIds([{ id: 63 }, { id: 'x' }, null, 5])).toEqual([
      63,
    ]);
  });

  it('returns [] for non-array content', () => {
    expect(contentInstanceIds(null)).toEqual([]);
    expect(contentInstanceIds({ id: 63 })).toEqual([]);
  });
});

describe('selectEventQuests', () => {
  it('keeps only the instance quests and bounds known ids to them + chains', () => {
    const known = [quest(1, null), quest(2, 63, 1), quest(3, 99), quest(4, 63)];
    const out = selectEventQuests(known, [63]);
    expect(out.eventQuests.map((q) => q.questId)).toEqual([2, 4]);
    expect([...out.knownIds].sort()).toEqual([1, 2, 4]);
  });
});

describe('buildMembers', () => {
  const signup = {
    userId: 1,
    username: 'u',
    characterId: 'c1',
    charClass: 'Mage',
    charRace: 'Human',
  };
  const at = new Date('2026-10-01T00:00:00.000Z');

  it('drops characters without a snapshot or with a schema-1 (no quests) one', () => {
    const snaps = new Map([['c1', { data: { gear: [] }, capturedAt: at }]]);
    expect(buildMembers([signup], snaps as never)).toEqual([]);
    expect(buildMembers([signup], new Map())).toEqual([]);
  });

  it('keeps a character whose snapshot has a quests slice', () => {
    const data = { quests: { completed: [5], inProgress: [{ questId: 6 }] } };
    const snaps = new Map([['c1', { data, capturedAt: at }]]);
    const [m] = buildMembers([signup], snaps as never);
    expect(m?.snapshot.capturedAt).toBe(at.toISOString());
    expect(m?.snapshot.quests.completed).toEqual([5]);
  });
});

const ALLIANCE = ['Human', 'Dwarf', 'Night Elf', 'Gnome'];
const HORDE = ['Orc', 'Undead', 'Tauren', 'Troll'];
const raced = (q: DungeonQuestDto, races: string[]): DungeonQuestDto => ({
  ...q,
  raceRestriction: races,
  classRestriction: null,
});
// Alliance chain 1 → 2 → 3 and Horde chain 11 → 12 → 13; 2/3/12/13 in-instance.
const known = [
  raced(quest(1, null), ALLIANCE),
  raced(quest(2, 90, 1), ALLIANCE),
  raced(quest(3, 90, 2), ALLIANCE),
  raced(quest(11, null), HORDE),
  raced(quest(12, 90, 11), HORDE),
  raced(quest(13, 90, 12), HORDE),
];
const member = (
  completed: number[],
  completedTruncated?: boolean,
): ForeverMember => ({
  userId: 1,
  username: 'u',
  characterId: 'c1',
  charClass: 'Mage',
  charRace: 'Human',
  snapshot: {
    capturedAt: '2026-10-01T00:00:00.000Z',
    quests: {
      completed,
      inProgress: [],
      ...(completedTruncated !== undefined ? { completedTruncated } : {}),
    },
  },
});
const progress = (m: ForeverMember) => ({
  ...selectEventQuests(known, [90]),
  members: [m],
});

describe('buildViewerPrereqs (ROK-1758)', () => {
  it('keeps only quests the viewer can take and counts each step once', () => {
    const m = member([]);
    const out = buildViewerPrereqs(progress(m), m, []);
    expect(out.quests.map((q) => q.questId)).toEqual([2, 3]);
    // Distinct outstanding pre-reqs: 1 and 2 (not 1 + 1,2 = 3, nor Horde's).
    expect(out.neededTotal).toBe(2);
  });

  it('reaches 0 once the viewer’s own faction chain is done', () => {
    const m = member([1, 2, 3]);
    expect(buildViewerPrereqs(progress(m), m, []).neededTotal).toBe(0);
  });

  it('truncated snapshot: steps above the highest sent id are unknown, not needed', () => {
    const cut = member([1], true);
    const outCut = buildViewerPrereqs(progress(cut), cut, []);
    expect(outCut.neededTotal).toBe(0);
    const full = member([1]);
    expect(buildViewerPrereqs(progress(full), full, []).neededTotal).toBe(1);
  });
});

describe('buildViewerPrereqs — same-name variants (ROK-1758)', () => {
  it('no race: same-name faction variants collapse to the one the panel shows', () => {
    // Web deduplicateByName/pickBestVariant: no race → first variant (2).
    const shared = known.map((q) =>
      q.questId === 2 || q.questId === 12 ? { ...q, name: 'Shared' } : q,
    );
    const m: ForeverMember = { ...member([]), charRace: null };
    const p = { ...selectEventQuests(shared, [90]), members: [m] };
    const out = buildViewerPrereqs(p, m, []);
    expect(out.quests.map((q) => q.questId)).toEqual([2, 3, 13]);
    // Steps 1, 2 (Alliance) and 11, 12 (the chain of Horde 13, which still shows).
    expect(out.neededTotal).toBe(4);
  });
});
