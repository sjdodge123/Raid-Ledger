/**
 * ROK-1733: core's character-identity seam. Proves the no-provider path
 * refuses identity fields with generic text, that a registered provider is
 * handed the looked-up game slug, and that both service catch paths give the
 * provider the chance to map a lost race to its 409.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CreateCharacterDto } from '@raid-ledger/contract';
import {
  checkIdentityClaim,
  prepareIdentityCreate,
  prepareIdentityUpdate,
  rejectIdentityFields,
  rejectRulesetField,
  resolveIdentity,
} from './characters-identity.helpers';
import { CharactersService } from './characters.service';

const SLUG = 'some-plugin-game';
const createDto: CreateCharacterDto = { gameId: 7, name: 'Ana', isMain: false };
const character = { id: 'c-1', gameId: 7, region: 'us' };

function selectReturning(rows: unknown[]) {
  return {
    from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
  };
}

function makeDb(gameRows: unknown[] = [{ slug: SLUG }]) {
  return { select: jest.fn(() => selectReturning(gameRows)) };
}

function makeProvider() {
  return {
    gameSlugs: [SLUG],
    pluginSlug: 'some-plugin',
    prepareCreate: jest.fn((_g: unknown, dto: CreateCharacterDto) => ({
      ...dto,
      name: 'Ana Normalized',
      region: 'eu' as const,
    })),
    prepareUpdate: jest.fn(() => Promise.resolve({ name: 'Renamed' })),
    checkClaim: jest.fn(() => Promise.resolve()),
    rethrowIdentityViolation: jest.fn(() => {
      throw new ConflictException('provider 409');
    }),
  };
}

function makeRegistry(
  provider?: ReturnType<typeof makeProvider>,
  pluginActive = true,
) {
  return {
    getAdapter: jest.fn(() => provider),
    isActive: jest.fn(() => pluginActive),
  };
}

describe('no-provider guards', () => {
  it('refuses region or ruleset on create with generic text', () => {
    for (const extra of [
      { region: 'us' as const },
      { ruleset: 'pvp' as const },
    ])
      expect(() => rejectIdentityFields({ ...createDto, ...extra })).toThrow(
        new BadRequestException('Region and ruleset do not apply to this game'),
      );
  });

  it('refuses ruleset on update with generic text', () => {
    expect(() => rejectRulesetField({ ruleset: 'pvp' })).toThrow(
      new BadRequestException('Ruleset does not apply to this game'),
    );
  });

  it('returns a clean DTO by reference', () => {
    const update = { name: 'X' };
    expect(rejectIdentityFields(createDto)).toBe(createDto);
    expect(rejectRulesetField(update)).toBe(update);
  });
});

describe('resolveIdentity', () => {
  it('asks the registry on the character-identity point for the slug', () => {
    const provider = makeProvider();
    const registry = makeRegistry(provider);
    expect(resolveIdentity(registry as never, SLUG)).toBe(provider);
    expect(registry.getAdapter).toHaveBeenCalledWith(
      'character-identity',
      SLUG,
    );
    expect(registry.isActive).toHaveBeenCalledWith('some-plugin');
  });

  it('skips a registered provider while its owning plugin is inactive', () => {
    const registry = makeRegistry(makeProvider(), false);
    expect(resolveIdentity(registry as never, SLUG)).toBeUndefined();
  });
});

describe('plugin off means off (identity rules switch off with the plugin)', () => {
  it('create: a plain DTO passes untouched and the provider is never asked', async () => {
    const provider = makeProvider();
    const reg = makeRegistry(provider, false) as never;
    const out = await prepareIdentityCreate(makeDb() as never, reg, createDto);
    expect(out).toEqual({ prepared: createDto, identity: undefined });
    expect(provider.prepareCreate).not.toHaveBeenCalled();
    await expect(
      prepareIdentityCreate(makeDb() as never, reg, {
        ...createDto,
        region: 'us',
      }),
    ).rejects.toThrow('Region and ruleset do not apply to this game');
  });

  it('update: a plain DTO passes untouched and the provider is never asked', async () => {
    const provider = makeProvider();
    const reg = makeRegistry(provider, false) as never;
    const dto = { name: 'Renamed Plain' };
    const out = await prepareIdentityUpdate(
      makeDb() as never,
      reg,
      1,
      character,
      dto,
    );
    expect(out).toEqual({ prepared: dto, identity: undefined });
    expect(provider.prepareUpdate).not.toHaveBeenCalled();
  });
});

describe('prepareIdentityCreate', () => {
  it('404s when the game does not exist', async () => {
    const run = prepareIdentityCreate(
      makeDb([]) as never,
      makeRegistry() as never,
      createDto,
    );
    await expect(run).rejects.toThrow(
      new NotFoundException('Game 7 not found'),
    );
  });

  it('without a provider refuses identity fields and passes a plain DTO', async () => {
    const db = makeDb() as never;
    const reg = makeRegistry() as never;
    await expect(
      prepareIdentityCreate(db, reg, { ...createDto, region: 'us' }),
    ).rejects.toThrow(BadRequestException);
    const out = await prepareIdentityCreate(db, reg, createDto);
    expect(out.prepared).toBe(createDto);
    expect(out.identity).toBeUndefined();
  });

  it('delegates to the provider with the looked-up slug', async () => {
    const provider = makeProvider();
    const registry = makeRegistry(provider);
    const out = await prepareIdentityCreate(
      makeDb() as never,
      registry as never,
      createDto,
    );
    expect(registry.getAdapter).toHaveBeenCalledWith(
      'character-identity',
      SLUG,
    );
    expect(provider.prepareCreate).toHaveBeenCalledWith(
      { slug: SLUG },
      createDto,
    );
    expect(out).toEqual({
      prepared: { ...createDto, name: 'Ana Normalized', region: 'eu' },
      identity: provider,
    });
  });
});

describe('prepareIdentityUpdate', () => {
  it('runs one game SELECT and delegates with that slug', async () => {
    const provider = makeProvider();
    const db = makeDb();
    const out = await prepareIdentityUpdate(
      db as never,
      makeRegistry(provider) as never,
      3,
      character,
      { name: 'r' },
    );
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(provider.prepareUpdate).toHaveBeenCalledWith(
      db,
      3,
      { slug: SLUG },
      character,
      { name: 'r' },
    );
    expect(out).toEqual({ prepared: { name: 'Renamed' }, identity: provider });
  });

  it('without a provider refuses ruleset and passes a plain DTO', async () => {
    const db = makeDb() as never;
    const reg = makeRegistry() as never;
    await expect(
      prepareIdentityUpdate(db, reg, 3, character, { ruleset: 'pvp' }),
    ).rejects.toThrow(
      new BadRequestException('Ruleset does not apply to this game'),
    );
    const dto = { name: 'r' };
    const out = await prepareIdentityUpdate(db, reg, 3, character, dto);
    expect(out.prepared).toBe(dto);
    expect(out.identity).toBeUndefined();
  });
});

describe('checkIdentityClaim', () => {
  const args = { gameId: 7, userId: 3, name: 'Ana' };

  it('claims through the provider when a region is present', async () => {
    const provider = makeProvider();
    await checkIdentityClaim({} as never, args, {
      region: 'us',
      identity: provider,
    });
    expect(provider.checkClaim).toHaveBeenCalledWith(
      {},
      { ...args, region: 'us' },
    );
  });

  it('skips the claim without a region', async () => {
    const provider = makeProvider();
    await checkIdentityClaim({} as never, args, {
      region: null,
      identity: provider,
    });
    expect(provider.checkClaim).not.toHaveBeenCalled();
  });
});

describe('CharactersService catch paths hand the error to the provider', () => {
  const raceError = new Error('unique violation');

  function makeService(
    db: Record<string, unknown>,
    provider: ReturnType<typeof makeProvider>,
  ) {
    return new CharactersService(
      db as never,
      makeRegistry(provider) as never,
      {} as never,
    );
  }

  it('create', async () => {
    const provider = makeProvider();
    const db = {
      ...makeDb(),
      transaction: jest.fn(() => Promise.reject(raceError)),
    };
    await expect(
      makeService(db, provider).create(3, createDto),
    ).rejects.toThrow('provider 409');
    expect(provider.rethrowIdentityViolation).toHaveBeenCalledWith(
      raceError,
      'Ana Normalized',
      'eu',
    );
  });

  it('update', async () => {
    const provider = makeProvider();
    const row = {
      ...character,
      userId: 3,
      name: 'Ana',
      realm: null,
      ruleset: 'pvp',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const db = {
      select: jest
        .fn()
        .mockReturnValueOnce(selectReturning([row]))
        .mockReturnValueOnce(selectReturning([{ slug: SLUG }])),
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => Promise.reject(raceError) }),
        }),
      }),
    };
    await expect(
      makeService(db, provider).update(3, 'c-1', { name: 'r' }),
    ).rejects.toThrow('provider 409');
    expect(provider.rethrowIdentityViolation).toHaveBeenCalledWith(
      raceError,
      'Renamed',
      'us',
    );
  });
});
