/**
 * ROK-1794 review P3 — THE import lock order (GUID, then guild) on BOTH
 * apply routes. The existing-character route used to take the guild lock
 * (in the guild section) before the GUID lock (in the binding write) while
 * the create route took them the other way round: two users racing on one
 * GUID + guild could deadlock (40P01 → 500). Sections, binding and target
 * resolution are mocked; each advisory lock is read off the rendered SQL.
 */
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { CharactersService } from '../../../characters/characters.service';
import type { AddonImportTx } from './addon-import-apply.types';
import {
  applyImport,
  type CreateImportInput,
} from './addon-import-create.apply';
import type { DecodedAddonPaste } from './addon-import.decoder';
import { ADDON_GUID_LOCK_CLASS, lockImportScope } from './addon-import.locks';
import { runPaste } from './addon-import.paste-run';
import { runForCharacter, type LoadedCharacter } from './addon-import.run';
import { resolveImportTarget } from './addon-import.target';

jest.mock('./addon-import.paste-run', () => ({
  ...jest.requireActual('./addon-import.paste-run'),
  runPaste: jest.fn(),
  shouldApplyBinding: jest.fn(() => false),
  buildPasteResult: jest.fn(() => ({ status: 'applied' })),
}));
jest.mock('./addon-import.binding-paste', () => ({
  bindEverySection: jest.fn(() => ({
    errors: [],
    pinGuid: 'Player-4395-0A1B2C3D',
  })),
}));
jest.mock('./addon-import.target', () => ({ resolveImportTarget: jest.fn() }));
jest.mock('./addon-import-create.helpers', () => ({
  ...jest.requireActual('./addon-import-create.helpers'),
  targetDto: jest.fn(() => ({})),
}));

const GUID = 'Player-4395-0A1B2C3D';
const GUID_KEY = `guid 7:us:${GUID}`;
const GUILD_KEY = 'guild guild-import:7:us:night shift';
const dialect = new PgDialect();

/** A tx that logs each advisory lock (and the steps the mocks log). */
function recorder() {
  const events: string[] = [];
  const execute = jest.fn((q: SQL) => {
    const { params } = dialect.sqlToQuery(q);
    const key = String(params[params.length - 1]);
    const isGuid = params[0] === ADDON_GUID_LOCK_CLASS;
    events.push(isGuid ? `guid ${key}` : `guild ${key}`);
    return Promise.resolve(undefined);
  });
  const tx = { execute } as unknown as AddonImportTx;
  jest.mocked(runPaste).mockImplementation(() => {
    events.push('sections');
    return Promise.resolve([]);
  });
  return { events, tx };
}

function guildPaste(withGuild = true): DecodedAddonPaste {
  const guild = { payload: { data: { name: '  Night Shift ' } } };
  return {
    sections: withGuild ? { guild } : {},
    order: withGuild ? ['guild'] : [],
    tokens: 1,
    inputBytes: 1,
  } as unknown as DecodedAddonPaste;
}

const character: LoadedCharacter = {
  id: 'c-1',
  gameId: 7,
  binding: {
    gameSlug: 'world-of-warcraft-forever',
    name: 'Ana Forever',
    region: 'us',
    ruleset: 'normal',
    class: 'Paladin',
    level: 42,
    addonGuid: null,
    race: null,
    gender: null,
  },
};

beforeEach(() => jest.clearAllMocks());

describe('lockImportScope', () => {
  it('takes the GUID lock, THEN the guild lock', async () => {
    const { events, tx } = recorder();
    const scope = { gameId: 7, region: 'us', guid: GUID };
    await lockImportScope(tx, { ...scope, paste: guildPaste() });
    expect(events).toEqual([GUID_KEY, GUILD_KEY]);
  });

  it('skips the lock it has no key for', async () => {
    const { events, tx } = recorder();
    await lockImportScope(tx, {
      gameId: 7,
      region: 'us',
      guid: null,
      paste: guildPaste(),
    });
    await lockImportScope(tx, {
      gameId: 7,
      region: 'us',
      guid: GUID,
      paste: guildPaste(false),
    });
    expect(events).toEqual([GUILD_KEY, GUID_KEY]);
  });
});

describe('both apply routes lock GUID → guild before anything runs', () => {
  it('existing-character route (runForCharacter, apply)', async () => {
    const { events, tx } = recorder();
    const binding = { errors: [], pinGuid: GUID } as never;
    const request = { dryRun: false, confirm: undefined };
    await runForCharacter(tx, 1, character, guildPaste(), binding, request);
    expect(events).toEqual([GUID_KEY, GUILD_KEY, 'sections']);
  });

  it('existing-character route takes no lock on a preview', async () => {
    const { events, tx } = recorder();
    const binding = { errors: [], pinGuid: GUID } as never;
    const request = { dryRun: true, confirm: undefined };
    await runForCharacter(tx, 1, character, guildPaste(), binding, request);
    expect(events).toEqual(['sections']);
  });

  it('create route (applyImport): both locks before the re-resolve', async () => {
    const { events, tx } = recorder();
    jest.mocked(resolveImportTarget).mockImplementation(() => {
      events.push('resolve');
      return Promise.resolve({ action: 'update', character } as never);
    });
    const db = {
      transaction: <T>(fn: (t: AddonImportTx) => Promise<T>) => fn(tx),
    } as unknown as AddonImportTx;
    const input = {
      userId: 1,
      paste: guildPaste(),
      request: { dryRun: false },
      who: { guid: GUID },
      query: { userId: 1, gameId: 7, region: 'us', guid: GUID, name: 'Ana' },
    } as unknown as CreateImportInput;
    const creator = {} as Pick<CharactersService, 'createWithin'>;
    await applyImport(db, creator, input);
    // The run's own scope re-enters both (already held: never blocks).
    expect(events).toEqual([
      GUID_KEY,
      GUILD_KEY,
      'resolve',
      GUID_KEY,
      GUILD_KEY,
      'sections',
    ]);
  });
});
