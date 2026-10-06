import { BadRequestException, ConflictException } from '@nestjs/common';
import type { CreateCharacterDto } from '@raid-ledger/contract';
import {
  checkRegionClaim,
  prepareCharacterUpdate,
  prepareCreateDto,
  prepareUpdateDto,
  rethrowForeverViolation,
} from './wow-forever-identity.helpers';
import { characterUniqueKeyJoin } from '../../characters/characters-unique-keys.helpers';

const FOREVER = { slug: 'world-of-warcraft-forever' };
const RETAIL = { slug: 'world-of-warcraft' };

function createDto(over: Partial<CreateCharacterDto> = {}): CreateCharacterDto {
  return {
    gameId: 7,
    name: 'Ana Forever',
    isMain: false,
    region: 'us',
    ruleset: 'pvp',
    ...over,
  };
}

/** Minimal select().from().where().limit() chain resolving to `rows`. */
function dbReturning(rows: Array<{ userId: number; name?: string }>) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };
  return chain as never;
}

describe('prepareCreateDto', () => {
  it('trims the two-part name and drops any realm for Forever', () => {
    const out = prepareCreateDto(
      FOREVER,
      createDto({ name: '  Ana Forever ', realm: 'area-52' }),
    );
    expect(out).toMatchObject({ name: 'Ana Forever', region: 'us' });
    expect(out.realm).toBeUndefined();
  });

  it.each([
    ['a single name', 'Ana'],
    ['digits', 'Ana F0rever'],
    ['a one-letter part', 'A Forever'],
    ['a 25-letter part', `Ana ${'x'.repeat(25)}`],
  ])('rejects %s', (_label, name) => {
    expect(() => prepareCreateDto(FOREVER, createDto({ name }))).toThrow(
      BadRequestException,
    );
  });

  it('requires region and ruleset for Forever', () => {
    expect(() =>
      prepareCreateDto(FOREVER, createDto({ region: undefined })),
    ).toThrow('WoW: Forever characters need a region and a ruleset');
    expect(() =>
      prepareCreateDto(FOREVER, createDto({ ruleset: undefined })),
    ).toThrow('WoW: Forever characters need a region and a ruleset');
  });

  it('rejects region/ruleset on any other game', () => {
    expect(() => prepareCreateDto(RETAIL, createDto())).toThrow(
      'Region and ruleset only apply to WoW: Forever characters',
    );
  });

  it('passes other games through unchanged', () => {
    const dto = createDto({
      name: 'Thrall',
      region: undefined,
      ruleset: undefined,
    });
    expect(prepareCreateDto(RETAIL, dto)).toBe(dto);
  });
});

describe('prepareUpdateDto', () => {
  it('allows a ruleset change on Forever', () => {
    expect(prepareUpdateDto(FOREVER, { ruleset: 'normal' })).toEqual({
      ruleset: 'normal',
    });
  });

  it('validates a Forever rename', () => {
    expect(() => prepareUpdateDto(FOREVER, { name: 'Ana' })).toThrow(
      'Enter a first and second name',
    );
  });

  it('rejects a realm on Forever and a ruleset elsewhere', () => {
    expect(() => prepareUpdateDto(FOREVER, { realm: 'area-52' })).toThrow(
      'WoW: Forever characters have no realm',
    );
    expect(() => prepareUpdateDto(RETAIL, { ruleset: 'pvp' })).toThrow(
      'Ruleset only applies to WoW: Forever characters',
    );
  });
});

describe('prepareCharacterUpdate — legacy Forever row (region NULL)', () => {
  const legacy = { id: 'c1', gameId: 7, region: null };
  const db = () => dbReturning([FOREVER as never]);

  it('refuses a ruleset with a clear 400', async () => {
    const err: unknown = await prepareCharacterUpdate(db(), 1, legacy, {
      ruleset: 'pvp',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(
      'This character has no region, so it cannot take a ruleset. Delete it and add it again to pick a region and ruleset.',
    );
  });

  it('keeps its one-word name saveable (e.g. a role change)', async () => {
    await expect(
      prepareCharacterUpdate(db(), 1, legacy, {
        name: 'Thrall',
        roleOverride: 'tank',
      }),
    ).resolves.toEqual({ name: 'Thrall', roleOverride: 'tank' });
  });
});

describe('checkRegionClaim', () => {
  const args = { gameId: 7, userId: 1, name: 'Ana Forever', region: 'us' };

  it('409s with the claimed-by-another-player message', async () => {
    await expect(
      checkRegionClaim(dbReturning([{ userId: 2, name: 'Ana Forever' }]), args),
    ).rejects.toThrow('Ana Forever (US) is already claimed by another player');
  });

  it("names the stored character, not the request's casing", async () => {
    await expect(
      checkRegionClaim(dbReturning([{ userId: 2, name: 'Ana Forever' }]), {
        ...args,
        name: 'ana forever',
      }),
    ).rejects.toThrow(
      new ConflictException(
        'Ana Forever (US) is already claimed by another player',
      ),
    );
  });

  it('409s with an own-list message for the same user', async () => {
    await expect(
      checkRegionClaim(dbReturning([{ userId: 1, name: 'Ana Forever' }]), args),
    ).rejects.toThrow('Ana Forever (US) is already on your character list');
  });

  it('passes when nobody holds the name', async () => {
    await expect(
      checkRegionClaim(dbReturning([]), args),
    ).resolves.toBeUndefined();
  });
});

describe('rethrowForeverViolation', () => {
  const violation = new Error(
    'duplicate key value violates unique constraint "idx_characters_ruleset_identity"',
  );

  it('maps the Forever index violation to the claim 409', () => {
    expect(() =>
      rethrowForeverViolation(violation, 'Ana Forever', 'eu'),
    ).toThrow(
      new ConflictException(
        'Ana Forever (EU) is already claimed by another player',
      ),
    );
  });

  it('title-cases the submitted name when the stored row is not at hand', () => {
    expect(() =>
      rethrowForeverViolation(violation, 'ana FOREVER', 'eu'),
    ).toThrow(
      new ConflictException(
        'Ana Forever (EU) is already claimed by another player',
      ),
    );
  });

  it('ignores other errors and region-less characters', () => {
    expect(() =>
      rethrowForeverViolation(new Error('boom'), 'Ana Forever', 'eu'),
    ).not.toThrow();
    expect(() =>
      rethrowForeverViolation(violation, 'Thrall', null),
    ).not.toThrow();
  });
});

describe('characterUniqueKeyJoin', () => {
  it('covers the per-user key and the Forever region + lower(name) key', () => {
    const join = characterUniqueKeyJoin('l', 'w');
    expect(join).toContain('l.realm IS NOT DISTINCT FROM w.realm');
    expect(join).toContain(
      'l.region = w.region AND lower(l.name) = lower(w.name)',
    );
    expect(join).toContain('l.ruleset IS NOT NULL AND w.ruleset IS NOT NULL');
  });
});
