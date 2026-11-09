/**
 * ROK-2149 — the seed-guild `withArmorySnapshots` fixture: every unlinked
 * roster row but the last gets a verified Armory snapshot (+ roster Blizzard
 * id and last-online), the last keeps the no-snapshot path.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CharacterEquipmentSchema,
  CharacterProfessionsSchema,
} from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import {
  buildSeedArmorySnapshot,
  seedArmoryBlizzardId,
  seedArmoryHalf,
  seedArmorySplit,
  seedGuildArmorySnapshots,
} from './demo-test-guild-armory.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';
import { isVerifiedSnapshot } from '../plugins/wow-common/guilds/roster-member/roster-member.helpers';

const NOW = new Date('2026-11-09T12:00:00.000Z');

describe('parseSeedGuildBody withArmorySnapshots', () => {
  it('defaults to false and accepts true', () => {
    expect(parseSeedGuildBody({ name: 'Arm Guild' }).withArmorySnapshots).toBe(
      false,
    );
    expect(
      parseSeedGuildBody({ name: 'Arm Guild', withArmorySnapshots: true })
        .withArmorySnapshots,
    ).toBe(true);
  });
});

describe('seedArmorySplit', () => {
  it('snapshots every unlinked row except the last', () => {
    expect(seedArmorySplit([11, 12, 13])).toEqual({
      memberIds: [11, 12],
      withoutSnapshot: [13],
    });
    expect(seedArmorySplit([11])).toEqual({
      memberIds: [],
      withoutSnapshot: [11],
    });
  });
});

describe('buildSeedArmorySnapshot', () => {
  const blizzardId = seedArmoryBlizzardId(42);
  const snap = buildSeedArmorySnapshot(blizzardId, NOW);

  it('is verified against the roster Blizzard id it is written with', () => {
    expect(snap.blizzardCharacterId).toBe(blizzardId);
    expect(isVerifiedSnapshot(blizzardId, { ...snap, lastError: null })).toBe(
      true,
    );
    expect(seedArmoryBlizzardId(43)).not.toBe(blizzardId);
  });

  it('carries the identity facts the page shows', () => {
    expect(snap).toMatchObject({
      level: 60,
      class: 'Warrior',
      race: 'Human',
      spec: 'Arms',
      role: 'dps',
      itemLevel: 63,
      syncedAt: NOW,
      lastLoginAt: null,
    });
    expect(snap.avatarUrl).toMatch(/^https:\/\//);
  });

  it('stores equipment and professions the read paths parse', () => {
    const equipment = CharacterEquipmentSchema.parse(snap.equipment);
    expect(equipment.items.map((i) => i.slot)).toEqual([
      'HEAD',
      'CHEST',
      'MAIN_HAND',
    ]);
    expect(
      CharacterProfessionsSchema.safeParse(snap.armoryProfessions).success,
    ).toBe(true);
  });

  it('stores talents in the classic Blizzard shape', () => {
    expect(snap.talents).toMatchObject({
      format: 'classic',
      summary: '31/20/0',
      trees: [
        { name: 'Arms', spentPoints: 31 },
        { name: 'Fury', spentPoints: 20 },
        { name: 'Protection', spentPoints: 0 },
      ],
    });
  });
});

describe('seedGuildArmorySnapshots', () => {
  it('stamps the roster row and upserts one snapshot per target', async () => {
    const db = createDrizzleMock();
    const out = await seedGuildArmorySnapshots(
      db as unknown as PostgresJsDatabase<typeof schema>,
      [7, 9],
      NOW,
    );
    expect(out).toEqual({ memberIds: [7], withoutSnapshot: [9] });
    expect(db.set).toHaveBeenCalledWith({
      blizzardCharacterId: seedArmoryBlizzardId(7),
      onlineAtExport: false,
      lastOnlineDays: 1,
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.values).toHaveBeenCalledWith(
      expect.objectContaining({
        guildMemberId: 7,
        blizzardCharacterId: seedArmoryBlizzardId(7),
        rosterLevel: 60,
        failures: 0,
      }),
    );
  });
});

describe('seedArmoryHalf', () => {
  it('writes nothing and adds no key without the flag', async () => {
    const db = createDrizzleMock();
    const out = await seedArmoryHalf(
      db as unknown as PostgresJsDatabase<typeof schema>,
      { withArmorySnapshots: false },
      [7, 9],
      NOW,
    );
    expect(out).toEqual({});
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });

  it('reports the split under armorySnapshots with the flag', async () => {
    const db = createDrizzleMock();
    const out = await seedArmoryHalf(
      db as unknown as PostgresJsDatabase<typeof schema>,
      { withArmorySnapshots: true },
      [7, 9],
      NOW,
    );
    expect(out).toEqual({
      armorySnapshots: { memberIds: [7], withoutSnapshot: [9] },
    });
  });
});
