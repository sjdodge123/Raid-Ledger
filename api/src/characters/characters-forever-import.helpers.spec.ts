/**
 * ROK-1722 — WoW: Forever Armory import rules: identity fields of an imported
 * row, the insert values, and the claim/merge step against a mocked tx.
 */
import { ConflictException } from '@nestjs/common';
import {
  ImportWowCharacterSchema,
  type ImportWowCharacterInput,
} from '@raid-ledger/contract';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import type { EnrichedProfile } from './characters-sync.helpers';
import {
  importIdentityFields,
  mergeIntoOwnForeverRow,
} from './characters-forever-import.helpers';
import { buildImportInsertValues } from './characters-import.helpers';

type Row = typeof schema.characters.$inferSelect;

const profile: EnrichedProfile['profile'] = {
  name: 'Ana Forever',
  realm: null,
  class: 'Mage',
  spec: 'Frost',
  role: 'dps',
  level: 24,
  race: 'Human',
  faction: 'alliance',
  itemLevel: 22,
  avatarUrl: null,
  renderUrl: null,
  profileUrl: null,
};
const noSync = { professions: null, equipment: null, talents: null };

const dto = (over: Partial<ImportWowCharacterInput> = {}) =>
  ImportWowCharacterSchema.parse({
    name: 'Ana Forever',
    region: 'us',
    gameVariant: 'wow_forever',
    ruleset: 'pvp',
    ...over,
  });

function row(over: Partial<Row> = {}): Row {
  const now = new Date('2026-11-01T00:00:00Z');
  return {
    id: 'char-1',
    userId: 7,
    gameId: 3,
    name: 'Ana Forever',
    realm: null,
    class: 'Mage',
    spec: null,
    role: null,
    roleOverride: null,
    isMain: true,
    itemLevel: null,
    externalId: null,
    avatarUrl: null,
    renderUrl: null,
    level: null,
    race: null,
    gender: null,
    faction: null,
    lastSyncedAt: null,
    profileUrl: null,
    region: 'us',
    ruleset: 'normal',
    addonGuid: null,
    gameVariant: null,
    equipment: null,
    talents: null,
    professions: null,
    displayOrder: 0,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('importIdentityFields (ROK-1722)', () => {
  it('Forever: realm null, the picked ruleset, the profile two-part name', () => {
    expect(importIdentityFields(profile, dto({ name: 'ana forever' }))).toEqual(
      {
        name: 'Ana Forever',
        realm: null,
        ruleset: 'pvp',
      },
    );
  });

  it("keeps the player's typed casing when the profile name is one part", () => {
    const oneWord = { ...profile, name: 'Ana' };
    expect(
      importIdentityFields(oneWord, dto({ name: '  ana FOREVER ' })).name,
    ).toBe('ana FOREVER');
  });

  it('sets externalId only when the profile carries one', () => {
    const withId = { ...profile, externalId: '900001' };
    expect(importIdentityFields(withId, dto()).externalId).toBe('900001');
    expect(importIdentityFields(profile, dto())).not.toHaveProperty(
      'externalId',
    );
  });

  it('retail keeps the profile name + realm and no ruleset', () => {
    const retail = { ...profile, name: 'Thrall', realm: 'Area 52' };
    const body = ImportWowCharacterSchema.parse({
      name: 'thrall',
      realm: 'area-52',
      region: 'us',
    });
    expect(importIdentityFields(retail, body)).toEqual({
      name: 'Thrall',
      realm: 'Area 52',
    });
  });
});

describe('buildImportInsertValues — Forever (ROK-1722)', () => {
  it('inserts realm null, the ruleset and game_variant wow_forever', () => {
    const values = buildImportInsertValues(7, 3, profile, dto(), noSync, true);
    expect(values).toMatchObject({
      userId: 7,
      gameId: 3,
      name: 'Ana Forever',
      realm: null,
      ruleset: 'pvp',
      region: 'us',
      gameVariant: 'wow_forever',
      isMain: true,
    });
  });
});

describe('mergeIntoOwnForeverRow (ROK-1722)', () => {
  const logger = { log: jest.fn() };
  const ctx = (userId: number) => ({
    userId,
    gameId: 3,
    profile,
    dto: dto(),
    sync: noSync,
    logger,
  });

  it("merges into the player's own manual row: ruleset overwritten, variant set", async () => {
    const tx = createDrizzleMock();
    const own = row({ userId: 7, ruleset: 'normal', gameVariant: null });
    tx.limit.mockResolvedValueOnce([own]);
    tx.returning.mockResolvedValueOnce([
      row({ ruleset: 'pvp', gameVariant: 'wow_forever' }),
    ]);
    const merged = await mergeIntoOwnForeverRow(tx as never, ctx(7));
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.set).toHaveBeenCalledWith(
      expect.objectContaining({
        ruleset: 'pvp',
        gameVariant: 'wow_forever',
        region: 'us',
      }),
    );
    expect(merged).toMatchObject({
      id: 'char-1',
      ruleset: 'pvp',
      gameVariant: 'wow_forever',
    });
  });

  it('Main ticked: demotes the old main, then promotes the merged row', async () => {
    const tx = createDrizzleMock();
    tx.limit.mockResolvedValueOnce([row({ userId: 7, isMain: false })]);
    tx.returning.mockResolvedValueOnce([row({ isMain: true })]);
    const merged = await mergeIntoOwnForeverRow(tx as never, {
      ...ctx(7),
      dto: dto({ isMain: true }),
    });
    expect(tx.set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ isMain: false }),
    );
    expect(tx.set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ isMain: true, ruleset: 'pvp' }),
    );
    expect(merged?.isMain).toBe(true);
  });

  it('Main unticked: leaves main status alone', async () => {
    const tx = createDrizzleMock();
    tx.limit.mockResolvedValueOnce([row({ userId: 7, isMain: false })]);
    tx.returning.mockResolvedValueOnce([row({ isMain: false })]);
    await mergeIntoOwnForeverRow(tx as never, ctx(7));
    expect(tx.set).toHaveBeenCalledTimes(1);
    expect(tx.set).not.toHaveBeenCalledWith(
      expect.objectContaining({ isMain: expect.anything() }),
    );
  });

  it('returns undefined (caller inserts) when nobody holds the identity', async () => {
    const tx = createDrizzleMock();
    tx.limit.mockResolvedValueOnce([]);
    await expect(
      mergeIntoOwnForeverRow(tx as never, ctx(7)),
    ).resolves.toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("409s when another player's row holds the identity, and writes nothing", async () => {
    const tx = createDrizzleMock();
    tx.limit.mockResolvedValueOnce([row({ userId: 99 })]);
    const err: unknown = await mergeIntoOwnForeverRow(
      tx as never,
      ctx(7),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err instanceof Error ? err.message : '').toBe(
      'Ana Forever (US) is already claimed by another player',
    );
    expect(tx.update).not.toHaveBeenCalled();
  });
});
