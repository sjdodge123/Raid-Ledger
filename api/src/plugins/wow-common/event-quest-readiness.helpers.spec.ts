import { EventQuestReadinessSchema } from '@raid-ledger/contract';
import * as chainHelpers from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { selectEventQuests } from './event-forever-progress.helpers';
import {
  buildQuestReadiness,
  type ReadinessSignup,
} from './event-quest-readiness.helpers';
import type { CharSnapshot } from './forever-char-snapshot.query';

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
  ...extra,
});

const snap = (completed: number[], inProgress: number[]): CharSnapshot => ({
  data: {
    quests: {
      completed,
      inProgress: inProgress.map((questId) => ({ questId })),
    },
  } as unknown as CharSnapshot['data'],
  capturedAt: AT,
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
    expect(body.quests.map((q) => q.questId).sort()).toEqual([200, 300, 500]);
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
    expect(stateOf(body, 3, 500)).toBeDefined();
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
    jest.spyOn(chainHelpers, 'walkChainInMemory').mockReturnValue([]);
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
