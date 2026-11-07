import { SETTING_KEYS } from '../../../drizzle/schema/app-settings';
import { parseAddonLink } from './guild-addon-url.helpers';
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

const LEDGERLINK_CURSEFORGE =
  'https://www.curseforge.com/wow/addons/ledger-link';

function storedLedgerLink(url: string): Record<string, unknown> {
  return {
    name: 'LedgerLink',
    url,
    note: 'Exports your roster, characters and raid pulls to Raid Ledger.',
    requirement: 'required',
    flavors: [],
  };
}

describe('DEFAULT_PINNED_ADDONS', () => {
  it('pins LedgerLink (required) and Mailworthy (optional), both on CurseForge', () => {
    expect(
      DEFAULT_PINNED_ADDONS.map((a) => [a.name, a.url, a.requirement]),
    ).toEqual([
      ['LedgerLink', LEDGERLINK_CURSEFORGE, 'required'],
      [
        'Mailworthy',
        'https://www.curseforge.com/wow/addons/mailworthy',
        'optional',
      ],
    ]);
  });

  it('every default passes the addon link parser as a CurseForge link', () => {
    for (const addon of DEFAULT_PINNED_ADDONS) {
      const parsed = parseAddonLink(addon.url);
      expect(parsed.ok && parsed.link.source).toBe('curseforge');
      expect(parsed.ok && parsed.link.url).toBe(addon.url);
    }
  });
});

describe('parsePinnedAddons', () => {
  it('falls back to the defaults when the setting is unset', () => {
    expect(parsePinnedAddons(null)).toEqual(DEFAULT_PINNED_ADDONS);
    expect(parsePinnedAddons('  ')).toEqual(DEFAULT_PINNED_ADDONS);
  });

  it.each([
    'https://github.com/sjdodge123/ledger-link',
    'https://github.com/sjdodge123/ledger-link/',
    'https://GitHub.com/SJDodge123/Ledger-Link',
    'https://www.github.com/sjdodge123/ledger-link/',
  ])(
    'upgrades a stored old LedgerLink GitHub url (%s) to CurseForge',
    (url) => {
      const stored = [storedLedgerLink(url), MAILWORTHY];
      expect(parsePinnedAddons(JSON.stringify(stored))).toEqual([
        storedLedgerLink(LEDGERLINK_CURSEFORGE),
        MAILWORTHY,
      ]);
    },
  );

  it('does not inject Mailworthy into a stored list', () => {
    const stored = [storedLedgerLink(LEDGERLINK_CURSEFORGE)];
    expect(parsePinnedAddons(JSON.stringify(stored))).toEqual(stored);
  });

  it('leaves a stored custom list untouched', () => {
    const custom = [
      { ...MAILWORTHY, name: 'Other', url: 'https://github.com/a/ledger-link' },
    ];
    expect(parsePinnedAddons(JSON.stringify(custom))).toEqual(custom);
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
