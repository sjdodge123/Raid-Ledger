/**
 * ROK-2214 — the dungeon plan query (comma-separated ids, coerced instance id)
 * and response schemas.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  DungeonPlanQuerySchema,
  DungeonPlanSchema,
} from '../wow-dungeon-plan.schema.js';
import { WowRosterClassSchema } from '../wow-roster-insights.schema.js';

const uuid = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111`;
const A = uuid(1);
const B = uuid(2);

const character = (characterId: string) => ({
  characterId,
  name: 'Aelin',
  class: 'Mage',
  level: 31,
  levelFit: 'in' as const,
});

const plan = {
  instance: { id: 90000004, name: 'City of Dalaran', minimumLevel: 28, maximumLevel: 33 },
  side: 'alliance' as const,
  sideSource: 'guild' as const,
  hiddenOtherFaction: 2,
  characters: [character(A)],
  droppedCharacterIds: [B],
  readiness: {
    quests: [{ questId: 101, title: 'Into the Spire', instanceId: 90000004 }],
    signups: [
      {
        userId: 7,
        characterId: A,
        name: 'Aelin',
        perQuest: [{ questId: 101, state: 'have' as const, prereqsMet: true, source: null }],
      },
    ],
  },
};

describe('DungeonPlanQuerySchema (C1)', () => {
  it('splits a comma-separated id list and trims each id', () => {
    const r = DungeonPlanQuerySchema.safeParse({ instanceId: '90000004', characterIds: `${A}, ${B}` });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ instanceId: 90000004, characterIds: [A, B] });
  });

  it('reads an empty or absent id list as []', () => {
    expect(DungeonPlanQuerySchema.parse({ instanceId: '5', characterIds: '' }).characterIds).toEqual([]);
    expect(DungeonPlanQuerySchema.parse({ instanceId: '5' }).characterIds).toEqual([]);
  });

  it('rejects six ids', () => {
    const six = [1, 2, 3, 4, 5, 6].map(uuid).join(',');
    expect(DungeonPlanQuerySchema.safeParse({ instanceId: '5', characterIds: six }).success).toBe(false);
  });

  it('rejects a non-uuid id', () => {
    const r = DungeonPlanQuerySchema.safeParse({ instanceId: '5', characterIds: `${A},not-a-uuid` });
    expect(r.success).toBe(false);
  });

  it('rejects a zero, non-numeric or missing instance id', () => {
    for (const instanceId of ['0', 'abc', '1.5', undefined]) {
      expect(DungeonPlanQuerySchema.safeParse({ instanceId }).success).toBe(false);
    }
  });

  it('rejects an unknown key', () => {
    expect(DungeonPlanQuerySchema.safeParse({ instanceId: '5', eventId: '3' }).success).toBe(false);
  });
});

describe('DungeonPlanSchema (C2)', () => {
  it('accepts a full plan and keeps it', () => {
    const r = DungeonPlanSchema.safeParse(plan);
    expect(r.success).toBe(true);
    expect(r.data).toEqual(plan);
  });

  it('accepts no side and no characters', () => {
    const empty = { ...plan, side: null, sideSource: null, hiddenOtherFaction: 0, characters: [], droppedCharacterIds: [] };
    expect(DungeonPlanSchema.safeParse(empty).success).toBe(true);
  });

  it('rejects an unknown levelFit', () => {
    const bad = { ...plan, characters: [{ ...character(A), levelFit: 'over' }] };
    expect(DungeonPlanSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects six characters', () => {
    const six = [1, 2, 3, 4, 5, 6].map((n) => character(uuid(n)));
    expect(DungeonPlanSchema.safeParse({ ...plan, characters: six }).success).toBe(false);
  });

  it('rejects a negative hidden count and an unknown key', () => {
    expect(DungeonPlanSchema.safeParse({ ...plan, hiddenOtherFaction: -1 }).success).toBe(false);
    expect(DungeonPlanSchema.safeParse({ ...plan, eventId: 3 }).success).toBe(false);
  });
});

describe('WowRosterClassSchema.members[].memberId (ROK-2214 Q1)', () => {
  const cls = (member: Record<string, unknown>) => ({ class: 'Mage', count: 1, members: [member] });

  it('accepts a member with or without memberId', () => {
    expect(WowRosterClassSchema.safeParse(cls({ name: 'Aelin', characterId: null, level: 30, memberId: 12 })).success).toBe(true);
    expect(WowRosterClassSchema.safeParse(cls({ name: 'Aelin', characterId: A, level: 30 })).success).toBe(true);
  });

  it('rejects a non-positive memberId', () => {
    expect(WowRosterClassSchema.safeParse(cls({ name: 'Aelin', characterId: null, level: 30, memberId: 0 })).success).toBe(false);
  });
});
