import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SettingsService } from '../../settings/settings.service';
import { decodeImportPaste } from './addon-import/addon-import.decoder';
import {
  buildCharPayload,
  buildImportString,
  buildWho,
} from './addon-import/testing/addon-fixture.builder';
import { pinExportClock } from './addon-import/testing/pin-export-clock';
import { ForeverRealmRulesetsService } from './forever-realm-rulesets.service';
import { WOW_FOREVER_REALM_RULESETS_KEY } from './forever.settings';

pinExportClock();

/** ROK-1739 §7.1 — the map's storage behaviour over a Map-backed settings stub. */
async function setup(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      ForeverRealmRulesetsService,
      { provide: SettingsService, useValue: settings },
    ],
  }).compile();
  return {
    service: moduleRef.get(ForeverRealmRulesetsService),
    store,
    settings,
  };
}

const KEY = WOW_FOREVER_REALM_RULESETS_KEY;
let warn: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('ForeverRealmRulesetsService.getMap (ROK-1739)', () => {
  it('returns no rows when nothing is stored, without warning', async () => {
    const { service } = await setup();
    expect(await service.getMap()).toEqual({ entries: [] });
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats corrupt JSON as no rows and warns once per bad value', async () => {
    const { service } = await setup({ [KEY]: '{not json' });
    expect(await service.getMap()).toEqual({ entries: [] });
    expect(await service.getMap()).toEqual({ entries: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('treats schema-invalid JSON as no rows', async () => {
    const bad = { entries: [{ region: 'cn', realmName: 'X', ruleset: 'pvp' }] };
    const { service } = await setup({ [KEY]: JSON.stringify(bad) });
    expect(await service.getMap()).toEqual({ entries: [] });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('ForeverRealmRulesetsService.saveMap (ROK-1739)', () => {
  it('stores the rows sorted and returns the stored map', async () => {
    const { service, store } = await setup();
    const saved = await service.saveMap({
      entries: [
        { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
        { region: 'eu', realmName: 'Frostmane', ruleset: 'hardcore' },
      ],
    });
    const expected = {
      entries: [
        { region: 'eu', realmName: 'Frostmane', ruleset: 'hardcore' },
        { region: 'us', realmName: 'Skyfall', ruleset: 'normal' },
      ],
    };
    expect(saved).toEqual(expected);
    expect(JSON.parse(store.get(KEY) ?? 'null')).toEqual(expected);
    expect(await service.getMap()).toEqual(expected);
  });

  it('deletes the setting when the list is empty', async () => {
    const stored = {
      entries: [{ region: 'us', realmName: 'A', ruleset: 'pvp' }],
    };
    const { service, store, settings } = await setup({
      [KEY]: JSON.stringify(stored),
    });
    expect(await service.saveMap({ entries: [] })).toEqual({ entries: [] });
    expect(store.has(KEY)).toBe(false);
    expect(settings.set).not.toHaveBeenCalled();
  });
});

describe('ForeverRealmRulesetsService.inferForPaste (ROK-1739)', () => {
  const paste = () =>
    decodeImportPaste(
      buildImportString(
        buildCharPayload({
          who: buildWho({
            ruleset: null,
            raw: { getUnitName: 'Ana Forever', realmName: 'Bloodmoon' },
          }),
        }),
      ),
    );

  it('infers from the stored map, and sees a save immediately', async () => {
    const { service } = await setup();
    expect(await service.inferForPaste(paste())).toBeNull();
    await service.saveMap({
      entries: [{ region: 'us', realmName: 'Bloodmoon', ruleset: 'pvp' }],
    });
    expect(await service.inferForPaste(paste())).toEqual({
      ruleset: 'pvp',
      realmName: 'Bloodmoon',
      source: 'realm-map',
    });
  });
});
