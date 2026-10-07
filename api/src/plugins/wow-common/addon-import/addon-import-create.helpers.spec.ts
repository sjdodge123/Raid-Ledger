import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AddonImportNewRequestSchema,
  type AddonWho,
} from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';
import {
  assertCreatable,
  createDtoFromExport,
  foreverGameId,
  HARDCORE_CREATE_MESSAGE,
  regionFromExport,
  targetDto,
  UNSUPPORTED_REGION_MESSAGE,
} from './addon-import-create.helpers';
import { AddonImportError } from './addon-import.errors';
import { parseImportRequest, rawFacts } from './addon-import.service.helpers';
import {
  buildGuildPayload,
  buildRaidPayload,
  buildWho,
} from './testing/addon-fixture.builder';

function thrown(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AddonImportError);
    const err = e as AddonImportError;
    const body = err.getResponse() as { message: string };
    return { code: err.code, message: body.message };
  }
  throw new Error('expected an AddonImportError, nothing was thrown');
}

const EXPECTED_DTO = {
  gameId: 7,
  name: 'Ana Forever',
  region: 'us',
  ruleset: 'normal',
  class: 'Paladin',
  isMain: false,
};

describe('createDtoFromExport (ROK-1738 D7 / D13 / A1)', () => {
  it('maps the export to the core create DTO', () => {
    expect(createDtoFromExport(buildWho(), 'us', 7)).toEqual(EXPECTED_DTO);
  });

  it('title-cases a multi-word class token and strips the realm', () => {
    const who = buildWho({ class: 'DEATHKNIGHT', fullName: 'Ana Forever-Realm' });
    const dto = createDtoFromExport(who, 'eu', 7);
    expect(dto).toEqual({ ...EXPECTED_DTO, region: 'eu', class: 'Death Knight' });
  });

  it('who.ruleset null + no pick → RULESET_REQUIRED', () => {
    const who = buildWho({ ruleset: null });
    expect(thrown(() => createDtoFromExport(who, 'us', 7))).toEqual({
      code: 'RULESET_REQUIRED',
      message: 'Choose which ruleset this character plays on.',
    });
  });

  it('who.ruleset null + pick pvp → DTO pvp', () => {
    const who = buildWho({ ruleset: null });
    expect(createDtoFromExport(who, 'us', 7, 'pvp').ruleset).toBe('pvp');
  });

  it('who.ruleset normal + pick pvp → DTO normal (export wins, pick ignored)', () => {
    const who = buildWho({ ruleset: 'normal' });
    expect(createDtoFromExport(who, 'us', 7, 'pvp').ruleset).toBe('normal');
  });

  it('Hardcore export → INVALID_PAYLOAD refusal (A1), even with a pick', () => {
    const who = buildWho({ ruleset: 'hardcore' });
    const expected = { code: 'INVALID_PAYLOAD', message: HARDCORE_CREATE_MESSAGE };
    expect(thrown(() => createDtoFromExport(who, 'us', 7, 'pvp'))).toEqual(expected);
    expect(thrown(() => assertCreatable(who))).toEqual(expected);
  });

  it('an export with no usable name → INVALID_PAYLOAD', () => {
    const who = buildWho({ fullName: '', raw: {} });
    expect(thrown(() => createDtoFromExport(who, 'us', 7)).code).toBe(
      'INVALID_PAYLOAD',
    );
  });

  it('guild- and raid-section envelope who → same DTO as a char who (Q7)', () => {
    const guildWho: AddonWho = buildGuildPayload().who;
    const raidWho: AddonWho = buildRaidPayload().who;
    expect(createDtoFromExport(guildWho, 'us', 7)).toEqual(EXPECTED_DTO);
    expect(createDtoFromExport(raidWho, 'us', 7)).toEqual(EXPECTED_DTO);
  });
});

describe('regionFromExport', () => {
  it('maps addon region ids', () => {
    expect([1, 2, 3, 4].map(regionFromExport)).toEqual(['us', 'kr', 'eu', 'tw']);
  });

  it('cn (5) → REGION_MISMATCH "unsupported region"', () => {
    expect(thrown(() => regionFromExport(5))).toEqual({
      code: 'REGION_MISMATCH',
      message: UNSUPPORTED_REGION_MESSAGE,
    });
  });
});

describe('targetDto', () => {
  const stored = {
    id: '22222222-2222-4222-8222-222222222222',
    gameId: 7,
    binding: {
      gameSlug: 'world-of-warcraft-forever',
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'roleplaying',
      class: 'Paladin',
      level: 40,
      addonGuid: null,
    },
  };

  it('create dry run: no id, the export ruleset (null = needs a pick)', () => {
    const who = buildWho({ ruleset: null });
    expect(targetDto({ action: 'create' }, who, 'us')).toEqual({
      action: 'create',
      characterId: null,
      name: 'Ana Forever',
      region: 'us',
      ruleset: null,
      class: 'Paladin',
      level: 60,
    });
  });

  it('create apply: the created id + ruleset', () => {
    const who = buildWho({ ruleset: null });
    const created = { id: stored.id, ruleset: 'pvp' as const };
    expect(targetDto({ action: 'create' }, who, 'us', created)).toEqual(
      expect.objectContaining({ characterId: stored.id, ruleset: 'pvp' }),
    );
  });

  it('update: the stored id, name and ruleset; the export class/level', () => {
    const who = buildWho({ fullName: 'ana forever' });
    expect(targetDto({ action: 'update', character: stored }, who, 'us')).toEqual({
      action: 'update',
      characterId: stored.id,
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'roleplaying',
      class: 'Paladin',
      level: 60,
    });
  });
});

describe('foreverGameId', () => {
  function db(rows: unknown[]) {
    const chain = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue(rows),
    };
    return chain as unknown as PostgresJsDatabase<typeof schema>;
  }

  it('returns the Forever games row id', async () => {
    await expect(foreverGameId(db([{ id: 7 }]))).resolves.toBe(7);
  });

  it('no Forever game row → WRONG_GAME', async () => {
    await expect(foreverGameId(db([]))).rejects.toMatchObject({ code: 'WRONG_GAME' });
  });
});

describe('parseImportRequest with the create-route schema (D1)', () => {
  const body = { importString: ' !RL1!char!abc ', dryRun: false, ruleset: 'pvp' };

  it('accepts and returns the picked ruleset', () => {
    const parsed = parseImportRequest(body, rawFacts(body), AddonImportNewRequestSchema);
    expect(parsed).toEqual({ importString: '!RL1!char!abc', dryRun: false, ruleset: 'pvp' });
  });

  it('the default (per-character) schema still rejects a ruleset key', () => {
    expect(() => parseImportRequest(body, rawFacts(body))).toThrow('Validation failed');
  });

  it('the create schema rejects a Hardcore pick', () => {
    const hc = { ...body, ruleset: 'hardcore' };
    expect(() =>
      parseImportRequest(hc, rawFacts(hc), AddonImportNewRequestSchema),
    ).toThrow('Validation failed');
  });
});
