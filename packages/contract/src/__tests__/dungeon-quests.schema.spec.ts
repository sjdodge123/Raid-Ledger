/**
 * ROK-2224 — the quest card DTO carries an optional `isEscort` flag that the
 * Dungeon quests widget and event Quest Prep read.
 * Runs under the contract workspace's vitest (`npm test -w @raid-ledger/contract`).
 */
import { describe, it, expect } from 'vitest';
import {
  DungeonQuestDtoSchema,
  EnrichedDungeonQuestDtoSchema,
} from '../dungeon-quests.schema.js';

const quest = {
  questId: 1144,
  dungeonInstanceId: 491,
  name: 'Willix the Importer',
  questLevel: 30,
  requiredLevel: 22,
  expansion: 'classic' as const,
  questGiverNpc: 'Willix the Importer',
  questGiverZone: 'Razorfen Kraul',
  prevQuestId: null,
  nextQuestId: null,
  rewardsJson: null,
  objectives: 'Escort Willix the Importer out of Razorfen Kraul.',
  classRestriction: null,
  raceRestriction: null,
  startsInsideDungeon: true,
  sharable: false,
  rewardXp: null,
  rewardGold: null,
  rewardType: 'none',
};

describe('DungeonQuestDtoSchema.isEscort (ROK-2224)', () => {
  it('keeps isEscort: true instead of stripping it', () => {
    expect(DungeonQuestDtoSchema.parse({ ...quest, isEscort: true }).isEscort).toBe(true);
  });

  it('leaves the key absent when the API omits it (additive)', () => {
    expect(DungeonQuestDtoSchema.parse(quest)).not.toHaveProperty('isEscort');
  });

  it('rejects a non-boolean isEscort', () => {
    expect(DungeonQuestDtoSchema.safeParse({ ...quest, isEscort: 1 }).success).toBe(false);
  });

  it('carries the flag through the enriched Quest Prep DTO', () => {
    const enriched = { ...quest, isEscort: true, rewards: null, prerequisiteChain: null };
    expect(EnrichedDungeonQuestDtoSchema.parse(enriched).isEscort).toBe(true);
  });
});

describe('DungeonQuestDtoSchema.startLocationUnconfirmed (ROK-2276)', () => {
  it('keeps startLocationUnconfirmed: true instead of stripping it', () => {
    const parsed = DungeonQuestDtoSchema.parse({ ...quest, startLocationUnconfirmed: true });
    expect(parsed.startLocationUnconfirmed).toBe(true);
  });

  it('leaves the key absent when the API omits it (additive)', () => {
    expect(DungeonQuestDtoSchema.parse(quest)).not.toHaveProperty('startLocationUnconfirmed');
  });

  it('carries the flag through the enriched Quest Prep DTO', () => {
    const enriched = { ...quest, startLocationUnconfirmed: true, rewards: null, prerequisiteChain: null };
    expect(EnrichedDungeonQuestDtoSchema.parse(enriched).startLocationUnconfirmed).toBe(true);
  });
});
