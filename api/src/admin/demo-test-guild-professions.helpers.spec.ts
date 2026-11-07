/**
 * ROK-2107 — the seed-guild `armoryProfessions` fixture: the body parses the
 * blob through CharacterProfessionsSchema and the seeded characters'
 * armory_professions column receives it.
 */
import { BadRequestException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { createDrizzleMock } from '../common/testing/drizzle-mock';
import type * as schema from '../drizzle/schema';
import { applyArmoryProfessions } from './demo-test-guild-professions.helpers';
import { parseSeedGuildBody } from './demo-test-guild.helpers';

const PROFS = {
  primary: [
    {
      id: 164,
      name: 'Blacksmithing',
      slug: 'blacksmithing',
      skillLevel: 300,
      maxSkillLevel: 300,
      tiers: [],
    },
  ],
  secondary: [],
  syncedAt: '2026-11-01T00:00:00.000Z',
};

describe('parseSeedGuildBody armoryProfessions', () => {
  it('is absent by default, carries a valid blob, rejects an invalid one', () => {
    expect(parseSeedGuildBody({ name: 'Prof Guild' })).not.toHaveProperty(
      'armoryProfessions',
    );
    expect(
      parseSeedGuildBody({ name: 'Prof Guild', armoryProfessions: PROFS })
        .armoryProfessions,
    ).toEqual(PROFS);
    expect(() =>
      parseSeedGuildBody({
        name: 'Prof Guild',
        armoryProfessions: { primary: 'x' },
      }),
    ).toThrow(
      new BadRequestException(
        'armoryProfessions must be a CharacterProfessions object',
      ),
    );
  });
});

describe('applyArmoryProfessions', () => {
  it('writes the blob to armory_professions of every linked character', async () => {
    const db = createDrizzleMock();
    await applyArmoryProfessions(
      db as unknown as PostgresJsDatabase<typeof schema>,
      { gm: { characterId: 'c1' }, outsider: { characterId: null } },
      PROFS,
    );
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith({ armoryProfessions: PROFS });
  });

  it('writes nothing when the fixture carries no blob', async () => {
    const db = createDrizzleMock();
    await applyArmoryProfessions(
      db as unknown as PostgresJsDatabase<typeof schema>,
      { gm: { characterId: 'c1' } },
      undefined,
    );
    expect(db.update).not.toHaveBeenCalled();
  });
});
