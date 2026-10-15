import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import {
  DEFAULT_PINNED_ADDONS,
  parsePinnedAddons,
  readPinnedAddons,
} from './guild-pinned-addons.helpers';

const MAILWORTHY = {
  name: 'Mailworthy',
  url: 'https://www.curseforge.com/wow/addons/mailworthy',
  note: null,
  requirement: 'optional',
  flavors: ['classic'],
};

describe('parsePinnedAddons', () => {
  it('falls back to LedgerLink when the setting is unset', () => {
    expect(parsePinnedAddons(null)).toEqual(DEFAULT_PINNED_ADDONS);
    expect(parsePinnedAddons('  ')).toEqual(DEFAULT_PINNED_ADDONS);
    expect(DEFAULT_PINNED_ADDONS[0]?.url).toBe(
      'https://github.com/sjdodge123/ledger-link',
    );
  });

  it('returns the stored list when it validates', () => {
    expect(parsePinnedAddons(JSON.stringify([MAILWORTHY]))).toEqual([
      MAILWORTHY,
    ]);
  });

  it('honours an explicit empty list (admin removed every pin)', () => {
    expect(parsePinnedAddons('[]')).toEqual([]);
  });

  it('falls back on malformed JSON', () => {
    expect(parsePinnedAddons('{not json')).toEqual(DEFAULT_PINNED_ADDONS);
  });

  it('falls back when an entry fails the schema (non-http url)', () => {
    const bad = [{ ...MAILWORTHY, url: 'javascript:alert(1)' }];
    expect(parsePinnedAddons(JSON.stringify(bad))).toEqual(
      DEFAULT_PINNED_ADDONS,
    );
  });

  it('returns a copy, so callers cannot mutate the default', () => {
    const first = parsePinnedAddons(null);
    first[0]?.flavors.push('retail');
    expect(parsePinnedAddons(null)).toEqual(DEFAULT_PINNED_ADDONS);
    expect(DEFAULT_PINNED_ADDONS[0]?.flavors).toEqual([]);
  });
});

describe('readPinnedAddons', () => {
  it('reads the guild_pinned_addons key', async () => {
    const get = jest.fn().mockResolvedValue(JSON.stringify([MAILWORTHY]));
    await expect(readPinnedAddons(get)).resolves.toEqual([MAILWORTHY]);
    expect(get).toHaveBeenCalledWith(SETTING_KEYS.GUILD_PINNED_ADDONS);
  });
});
