/**
 * AddonImportCreateService orchestration (ROK-1738): D13 ruleset picker
 * branches, A1 Hardcore refusal (dry run + apply), D2 claim rejects, D4
 * lock-first re-resolve, create vs update, D8 audit `characterId`. The
 * resolver, decoder and per-character run are mocked; DB-backed behaviour
 * lives in `addon-import-create.integration.spec.ts` (L3).
 */
import { ConflictException } from '@nestjs/common';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AddonWho } from '@raid-ledger/contract';
import type * as schema from '../../../drizzle/schema';
import type { CharactersService } from '../../../characters/characters.service';
import { RULESET_IDENTITY_INDEX } from '../../../characters/characters-unique-keys.helpers';
import type { AddonImportAuditService } from './addon-import.audit';
import { HARDCORE_CREATE_MESSAGE } from './addon-import-create.helpers';
import { NIL_CHARACTER_ID } from './addon-import-create.apply';
import { AddonImportCreateService } from './addon-import-create.service';
import { decodeImportPaste } from './addon-import.decoder';
import { AddonImportError } from './addon-import.errors';
import { loadImportCharacter, runForCharacter } from './addon-import.run';
import { resolveImportTarget } from './addon-import.target';

jest.mock('./addon-import.decoder', () => ({ decodeImportPaste: jest.fn() }));
jest.mock('./addon-import.target', () => ({ resolveImportTarget: jest.fn() }));
jest.mock('./addon-import.run', () => ({
  bindPaste: jest.fn(() => ({ errors: [], warnings: [], diff: {} })),
  loadImportCharacter: jest.fn(),
  runForCharacter: jest.fn(),
}));
jest.mock('./addon-import-create.helpers', () => ({
  ...jest.requireActual('./addon-import-create.helpers'),
  foreverGameId: jest.fn().mockResolvedValue(7),
}));

beforeEach(() => jest.clearAllMocks());

const NEW_ID = '00000000-0000-4000-8000-0000000000aa';
const OWN_ID = '00000000-0000-4000-8000-0000000000bb';
const GUID = 'Player-4395-0A1B2C3D';

function who(over: Partial<AddonWho> = {}): AddonWho {
  return {
    guid: GUID,
    fullName: 'Ana Forever-Doomhowl',
    raw: {},
    ruleset: 'normal',
    class: 'PALADIN',
    race: 'Human',
    level: 42,
    faction: 'Alliance',
    ...over,
  };
}

function paste(w: AddonWho) {
  const payload = {
    section: 'char',
    exportedAt: 1,
    client: { region: 1 },
    who: w,
  };
  const section = { payload, pages: 1, sha256: 'abc', inputBytes: 10 };
  return {
    sections: { char: section },
    order: ['char'],
    tokens: 1,
    inputBytes: 10,
  };
}

function loaded(id: string, ruleset: string | null) {
  return {
    id,
    gameId: 7,
    binding: {
      gameSlug: 'world-of-warcraft-forever',
      name: 'Ana Forever',
      region: 'us',
      ruleset,
      class: 'Paladin',
      level: 42,
      addonGuid: null,
    },
  };
}

function setup(w: AddonWho, target: unknown = { action: 'create' }) {
  (decodeImportPaste as jest.Mock).mockReturnValue(paste(w));
  (resolveImportTarget as jest.Mock).mockReset().mockResolvedValue(target);
  (runForCharacter as jest.Mock)
    .mockReset()
    .mockResolvedValue({ section: 'char', status: 'applied', warnings: [] });
  (loadImportCharacter as jest.Mock)
    .mockReset()
    .mockResolvedValue(loaded(NEW_ID, 'pvp'));
  const tx = { execute: jest.fn().mockResolvedValue(undefined) };
  const db = { transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)) };
  const characters = {
    createWithin: jest.fn().mockResolvedValue({ id: NEW_ID }),
  };
  const audit = {
    reserveAttempt: jest.fn().mockResolvedValue(41),
    recordAttempt: jest.fn().mockResolvedValue(undefined),
    recordSections: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AddonImportCreateService(
    db as unknown as PostgresJsDatabase<typeof schema>,
    characters as unknown as CharactersService,
    audit as unknown as AddonImportAuditService,
  );
  return { service, tx, characters, audit };
}

const body = (dryRun: boolean, extra: object = {}) => ({
  importString: '!RL1!char!x',
  dryRun,
  ...extra,
});

async function codeOf(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    const err = e as AddonImportError;
    return {
      code: err.code,
      message: (err.getResponse() as { message: string }).message,
    };
  }
  throw new Error('expected a rejection');
}

function audited(audit: ReturnType<typeof setup>['audit']) {
  return audit.recordAttempt.mock.calls[0]?.[0] as {
    characterId: string | null;
    result: string;
  };
}

describe('AddonImportCreateService — D13 ruleset picker', () => {
  it('dry run, no export ruleset → create target with ruleset null, nothing created', async () => {
    const s = setup(who({ ruleset: null }));
    const res = await s.service.importNew(1, body(true, { ruleset: 'pvp' }));
    expect(res.target).toEqual({
      action: 'create',
      characterId: null,
      name: 'Ana Forever',
      region: 'us',
      ruleset: null,
      class: 'Paladin',
      level: 42,
    });
    expect(s.characters.createWithin).not.toHaveBeenCalled();
    expect(s.tx.execute).not.toHaveBeenCalled();
    expect((runForCharacter as jest.Mock).mock.calls[0]?.[2].id).toBe(
      NIL_CHARACTER_ID,
    );
    expect(audited(s.audit)).toMatchObject({ characterId: null });
  });

  it('apply, no export ruleset, no pick → RULESET_REQUIRED before any write', async () => {
    const s = setup(who({ ruleset: null }));
    expect(await codeOf(s.service.importNew(1, body(false)))).toMatchObject({
      code: 'RULESET_REQUIRED',
    });
    expect(s.characters.createWithin).not.toHaveBeenCalled();
    expect(audited(s.audit)).toMatchObject({
      result: 'RULESET_REQUIRED',
      characterId: null,
    });
  });

  it('apply, no export ruleset, picked pvp → created with pvp; target + audit carry the id', async () => {
    const s = setup(who({ ruleset: null }));
    const res = await s.service.importNew(1, body(false, { ruleset: 'pvp' }));
    expect(s.characters.createWithin).toHaveBeenCalledWith(s.tx, 1, {
      gameId: 7,
      name: 'Ana Forever',
      region: 'us',
      ruleset: 'pvp',
      class: 'Paladin',
      isMain: false,
    });
    expect(res.target).toMatchObject({
      action: 'create',
      characterId: NEW_ID,
      ruleset: 'pvp',
    });
    expect(audited(s.audit)).toMatchObject({
      characterId: NEW_ID,
      result: 'applied',
    });
  });

  it('export ruleset wins over a pick', async () => {
    const s = setup(who({ ruleset: 'normal' }));
    await s.service.importNew(1, body(false, { ruleset: 'pvp' }));
    expect(s.characters.createWithin.mock.calls[0]?.[2]).toMatchObject({
      ruleset: 'normal',
    });
  });

  it('update target ignores a pick and creates nothing', async () => {
    const own = loaded(OWN_ID, 'roleplaying');
    const s = setup(who({ ruleset: null }), {
      action: 'update',
      character: own,
    });
    const res = await s.service.importNew(1, body(false, { ruleset: 'pvp' }));
    expect(s.characters.createWithin).not.toHaveBeenCalled();
    expect((runForCharacter as jest.Mock).mock.calls[0]?.[2]).toBe(own);
    expect(res.target).toMatchObject({
      action: 'update',
      characterId: OWN_ID,
      ruleset: 'roleplaying',
    });
    expect(audited(s.audit)).toMatchObject({ characterId: OWN_ID });
  });
});

describe('AddonImportCreateService — A1, claims, D4', () => {
  it.each([true, false])(
    'Hardcore export on create (dryRun=%s) → INVALID_PAYLOAD, nothing run',
    async (dryRun) => {
      const s = setup(who({ ruleset: 'hardcore' }));
      expect(await codeOf(s.service.importNew(1, body(dryRun)))).toEqual({
        code: 'INVALID_PAYLOAD',
        message: HARDCORE_CREATE_MESSAGE,
      });
      expect(s.characters.createWithin).not.toHaveBeenCalled();
      expect(runForCharacter).not.toHaveBeenCalled();
    },
  );

  it('Hardcore export on an update target is not refused (update path unchanged)', async () => {
    const s = setup(who({ ruleset: 'hardcore' }), {
      action: 'update',
      character: loaded(OWN_ID, 'hardcore'),
    });
    await expect(s.service.importNew(1, body(false))).resolves.toMatchObject({
      target: { action: 'update' },
    });
  });

  it('resolver CHARACTER_CLAIMED propagates and is audited', async () => {
    const s = setup(who());
    (resolveImportTarget as jest.Mock).mockRejectedValue(
      new AddonImportError('CHARACTER_CLAIMED'),
    );
    expect(await codeOf(s.service.importNew(1, body(false)))).toMatchObject({
      code: 'CHARACTER_CLAIMED',
    });
    expect(audited(s.audit)).toMatchObject({ result: 'CHARACTER_CLAIMED' });
  });

  it.each([
    ['a core 409', new ConflictException('claimed')],
    [
      'a lost identity-index race',
      new Error(
        `duplicate key value violates unique constraint "${RULESET_IDENTITY_INDEX}"`,
      ),
    ],
  ])(
    '%s during create → CHARACTER_CLAIMED after rollback',
    async (_label, err) => {
      const s = setup(who());
      s.characters.createWithin.mockRejectedValue(err);
      expect(await codeOf(s.service.importNew(1, body(false)))).toMatchObject({
        code: 'CHARACTER_CLAIMED',
      });
    },
  );

  it('own-row collision during create → ONE retry in a fresh tx becomes an update (review NIT)', async () => {
    const s = setup(who());
    (resolveImportTarget as jest.Mock)
      .mockResolvedValueOnce({ action: 'create' })
      .mockResolvedValueOnce({
        action: 'update',
        character: loaded(OWN_ID, 'normal'),
      });
    s.characters.createWithin.mockRejectedValueOnce(
      new ConflictException(
        'Ana Forever (US) is already on your character list',
      ),
    );
    await expect(s.service.importNew(1, body(false))).resolves.toMatchObject({
      target: { action: 'update', characterId: OWN_ID },
    });
    expect(s.characters.createWithin).toHaveBeenCalledTimes(1);
  });

  it('a collision that persists is retried once only → CHARACTER_CLAIMED', async () => {
    const s = setup(who());
    s.characters.createWithin.mockRejectedValue(new ConflictException('x'));
    expect(await codeOf(s.service.importNew(1, body(false)))).toMatchObject({
      code: 'CHARACTER_CLAIMED',
    });
    expect(s.characters.createWithin).toHaveBeenCalledTimes(2);
  });

  it('a 409 outside the create step is NOT remapped', async () => {
    const s = setup(who(), {
      action: 'update',
      character: loaded(OWN_ID, 'normal'),
    });
    const conflict = new ConflictException('other');
    (runForCharacter as jest.Mock).mockRejectedValue(conflict);
    await expect(s.service.importNew(1, body(false))).rejects.toBe(conflict);
  });

  it('apply takes the GUID lock BEFORE re-resolving the target', async () => {
    const s = setup(who());
    await s.service.importNew(1, body(false));
    const lockAt = s.tx.execute.mock.invocationCallOrder[0] ?? Infinity;
    const resolveAt =
      (resolveImportTarget as jest.Mock).mock.invocationCallOrder[0] ?? -1;
    expect(lockAt).toBeLessThan(resolveAt);
    expect((resolveImportTarget as jest.Mock).mock.calls[0]?.[0]).toBe(s.tx);
  });

  it('rate limit runs before the body is parsed', async () => {
    const s = setup(who());
    s.audit.reserveAttempt.mockRejectedValue(
      new AddonImportError('RATE_LIMITED'),
    );
    expect(
      await codeOf(s.service.importNew(1, { importString: '' })),
    ).toMatchObject({ code: 'RATE_LIMITED' });
    expect(decodeImportPaste).not.toHaveBeenCalled();
  });
});
