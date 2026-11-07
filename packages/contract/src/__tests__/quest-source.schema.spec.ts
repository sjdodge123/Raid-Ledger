/**
 * ROK-2109: the Armory quest source (`blizzard`) is an additive widening of
 * the quest-progress and character-quests contracts.
 */
import { describe, expect, it } from 'vitest';
import { CharacterQuestsDtoSchema } from '../character-quests.schema.js';
import { QuestProgressSourceSchema } from '../quest-progress.schema.js';

const counts = { completedKnown: 0, knownTotal: 0, completedTotal: 1, inProgress: 0 };
const base = {
  syncedAt: '2026-11-07T10:00:00.000Z',
  inProgress: [],
  completedKnown: [],
  counts,
};

describe('quest source contract (ROK-2109)', () => {
  it('accepts blizzard as a progress source beside addon and manual', () => {
    for (const s of ['addon', 'manual', 'blizzard']) {
      expect(QuestProgressSourceSchema.safeParse(s).success).toBe(true);
    }
    expect(QuestProgressSourceSchema.safeParse('roster').success).toBe(false);
  });

  it('parses a blizzard character-quests DTO with a null in-progress date', () => {
    const dto = { ...base, source: 'blizzard', inProgressSyncedAt: null };
    expect(CharacterQuestsDtoSchema.parse(dto)).toEqual(dto);
  });

  it('still parses the old addon-only shape (no inProgressSyncedAt)', () => {
    const dto = { ...base, source: 'addon' };
    expect(CharacterQuestsDtoSchema.parse(dto)).toEqual(dto);
  });
});
