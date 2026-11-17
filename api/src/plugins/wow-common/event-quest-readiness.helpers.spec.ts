import { EventQuestReadinessSchema } from '@raid-ledger/contract';
import * as chainHelpers from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { selectEventQuests } from './event-forever-progress.helpers';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import type { EffectiveQuests } from './forever-quest-source.helpers';

const quest = (
  questId: number,
  instance: number | null,
  extra: Record<string, unknown> = {},
): DungeonQuestDto =>
  ({
    questId,
    name: `Q${questId}`,
    dungeonInstanceId: instance,
    prevQuestId: null,
    nextQuestId: null,
    ...extra,
  }) as unknown as DungeonQuestDto;

/** 300 (instance 63) chains from 100 (no instance); 200 in 63; 500 is Horde-only. */
const KNOWN = [
  quest(100, null, { nextQuestId: 300 }),
  quest(300, 63, { prevQuestId: 100 }),
  quest(200, 63),
  quest(500, 63, { raceRestriction: ['Orc'] }),
];
const SET = selectEventQuests(KNOWN, [63]);
const AT = new Date('2026-10-01T12:00:00.000Z');
const C1 = '11111111-1111-4111-8111-111111111111';
const C2 = '22222222-2222-4222-8222-222222222222';

const signup = (
  userId: number,
  characterId: string | null,
  extra: Partial<ReadinessSignup> = {},
): ReadinessSignup => ({
  userId,
  username: `u${userId}`,
  characterId,
  characterName: characterId ? `C${userId}` : null,
  charClass: null,
  charRace: 'Human',
  charFaction: null,
  ...extra,
});

const snap = (
  completed: number[],
  inProgress: number[],
  source: EffectiveQuests['source'] = 'addon',
): EffectiveQuests => ({
  quests: {
    completed,
    inProgress: inProgress.map((questId) => ({ questId })),
  },
  capturedAt: AT,
  source,
  inProgressAsOf: source === 'addon' ? AT : null,
});

const manual = (userId: number, questId: number, completed: boolean) => ({
  id: 9,
  userId,
  questId,
  pickedUp: !completed,
  completed,
  updatedAt: AT,
});

function stateOf(
  body: ReturnType<typeof buildQuestReadiness>,
  userId: number,
  questId: number,
) {
  const row = body.signups.find((s) => s.userId === userId);
  return row?.perQuest.find((p) => p.questId === questId);
}

const BODY = buildQuestReadiness({
  quests: SET,
  signups: [signup(1, C1), signup(2, C2), signup(3, null, { charRace: null })],
  snapshots: new Map([[C1, snap([100], [200])]]),
  manual: [manual(2, 300, true), manual(1, 200, true)],
});

describe('buildQuestReadiness (ROK-1911)', () => {
  const body = BODY;

  it('lists the event quests (instance match only, chain steps excluded)', () => {
    // 500 is Horde-only: the all-Alliance roster never gets it (ROK-2211).
    expect(body.quests.map((q) => q.questId).sort()).toEqual([200, 300]);
    expect(body.quests[0]).toMatchObject({ instanceId: 63 });
  });

  it('addon snapshot: in-progress = have, chain met; a manual tick wins (D5)', () => {
    expect(stateOf(body, 1, 300)).toEqual({
      questId: 300,
      state: 'missing',
      prereqsMet: true,
      source: null,
    });
    expect(stateOf(body, 1, 200)).toEqual({
      questId: 200,
      state: 'done',
      prereqsMet: true,
      source: 'manual',
    });
  });
});

describe('buildQuestReadiness addon-only (ROK-1911)', () => {
  it('addon have state carries source addon', () => {
    const only = buildQuestReadiness({
      quests: SET,
      signups: [signup(1, C1)],
      snapshots: new Map([[C1, snap([100], [200])]]),
      manual: [],
    });
    expect(stateOf(only, 1, 200)).toMatchObject({
      state: 'have',
      source: 'addon',
    });
  });
});

describe('buildQuestReadiness roster (ROK-1911)', () => {
  const body = BODY;

  it('no snapshot: manual tick is done, everything else unknown, prereqs null', () => {
    expect(stateOf(body, 2, 300)).toEqual({
      questId: 300,
      state: 'done',
      prereqsMet: null,
      source: 'manual',
    });
    expect(stateOf(body, 2, 200)).toMatchObject({
      state: 'unknown',
      prereqsMet: true,
      source: null,
    });
  });

  it("sends each signup's character uuid (ROK-1911)", () => {
    expect(body.signups.find((s) => s.userId === 1)?.characterId).toBe(C1);
    expect(body.signups.find((s) => s.userId === 2)?.characterId).toBe(C2);
  });

  it('a signup without a character is listed by username, all unknown', () => {
    const row = body.signups.find((s) => s.userId === 3);
    expect(row).toMatchObject({ name: 'u3', characterId: null });
    expect(row?.perQuest.every((p) => p.state === 'unknown')).toBe(true);
  });

  it('skips quests the character race cannot take (ROK-1758)', () => {
    expect(stateOf(body, 1, 500)).toBeUndefined();
    // Roster side unknown (no race, no faction): no filter, as before ROK-2211.
    const unknownSide = buildQuestReadiness({
      quests: SET,
      signups: [
        signup(1, C1, { charRace: null }),
        signup(3, null, { charRace: null }),
      ],
      snapshots: new Map(),
      manual: [],
    });
    expect(unknownSide.quests.map((q) => q.questId)).toContain(500);
    expect(stateOf(unknownSide, 3, 500)).toBeDefined();
  });

  it('parses against EventQuestReadinessSchema', () => {
    expect(EventQuestReadinessSchema.safeParse(body).success).toBe(true);
  });
});

describe('buildQuestReadiness caps (ROK-1911)', () => {
  it('caps quests at 200 and signups at 100', () => {
    const many = Array.from({ length: 210 }, (_, i) => quest(1000 + i, 63));
    const big = buildQuestReadiness({
      quests: selectEventQuests(many, [63]),
      signups: Array.from({ length: 105 }, (_, i) => signup(i + 1, null)),
      snapshots: new Map(),
      manual: [],
    });
    expect(big.quests).toHaveLength(200);
    expect(big.signups).toHaveLength(100);
    expect(big.signups[0]?.perQuest).toHaveLength(200);
  });
});

describe('buildQuestReadiness prereqsMet without a chain position (ROK-1911)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is null (unknown), not true, when the quest is missing from its own chain', () => {
    // ROK-2221: readiness walks via walkChainWithExternalRoot.
    jest.spyOn(chainHelpers, 'walkChainWithExternalRoot').mockReturnValue([]);
    const body = buildQuestReadiness({
      quests: SET,
      signups: [signup(1, C1)],
      snapshots: new Map([[C1, snap([100], [200])]]),
      manual: [],
    });
    expect(stateOf(body, 1, 300)?.prereqsMet).toBeNull();
    expect(stateOf(body, 1, 200)?.prereqsMet).toBeNull();
  });
});

describe('buildQuestReadiness external prerequisite root (ROK-2221)', () => {
  // Scholomance: 4735 (not bundled) -> 5522 (outside) -> 5531 -> 4771.
  const set = selectEventQuests(
    [
      quest(5522, null, { prevQuestId: 4735, nextQuestId: 5531 }),
      quest(5531, 246, { prevQuestId: 5522, nextQuestId: 4771 }),
      quest(4771, 246, { prevQuestId: 5531 }),
    ],
    [246],
  );
  const run = (completed: number[]) =>
    buildQuestReadiness({
      quests: set,
      signups: [signup(1, C1)],
      snapshots: new Map([[C1, snap(completed, [])]]),
      manual: [],
    });

  it('counts the outside root 4735 in the known ids', () => {
    expect(set.knownIds.has(4735)).toBe(true);
  });

  it("Dawn's Gambit (4771) prereqs met once 4735, 5522 and 5531 are done", () => {
    expect(stateOf(run([4735, 5522, 5531]), 1, 4771)?.prereqsMet).toBe(true);
  });

  it('prereqs not met while the outside root 4735 is not done', () => {
    expect(stateOf(run([5522, 5531]), 1, 4771)?.prereqsMet).toBe(false);
  });
});

describe('buildQuestReadiness escorts (ROK-2224)', () => {
  const body = buildQuestReadiness({
    quests: selectEventQuests([quest(1144, 491), quest(1101, 491)], [491]),
    signups: [signup(1, C1)],
    snapshots: new Map(),
    manual: [],
  });
  const column = (questId: number) =>
    body.quests.find((q) => q.questId === questId);

  it('flags the escort column (Willix the Importer) with isEscort: true', () => {
    expect(column(1144)).toEqual({
      questId: 1144,
      title: 'Q1144',
      instanceId: 491,
      isEscort: true,
    });
    expect(EventQuestReadinessSchema.parse(body).quests).toContainEqual(
      expect.objectContaining({ questId: 1144, isEscort: true }),
    );
  });

  it('leaves the key off a non-escort column', () => {
    expect(column(1101)).toEqual({
      questId: 1101,
      title: 'Q1101',
      instanceId: 491,
    });
  });
});
