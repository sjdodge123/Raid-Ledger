/**
 * ROK-2147 — pure helpers for the char export's installed-addon list:
 * case-insensitive keep-first de-duplication and the read DTO mapping.
 */
import type { AddonInstalled } from '@raid-ledger/contract';
import {
  dedupeInstalled,
  installedAddonKey,
  toInstalledAddonsView,
} from './addon-import-char.installed.helpers';

const addon = (name: string, loaded = true): AddonInstalled => ({
  name,
  loaded,
});

describe('dedupeInstalled', () => {
  it('keeps the FIRST of a case-insensitive duplicate folder name', () => {
    const out = dedupeInstalled([
      addon('WeakAuras', true),
      addon('Details'),
      addon('weakauras', false),
      addon('DETAILS', false),
    ]);
    expect(out.map((a) => [a.name, a.loaded])).toEqual([
      ['WeakAuras', true],
      ['Details', true],
    ]);
  });

  it('drops a name the sanitizer emptied, keeps order otherwise', () => {
    const out = dedupeInstalled([addon('  '), addon('B'), addon('A')]);
    expect(out.map((a) => a.name)).toEqual(['B', 'A']);
  });

  it('returns [] for [] (an empty list is stored, not ignored)', () => {
    expect(dedupeInstalled([])).toEqual([]);
  });

  it('keys trim + lower-case', () => {
    expect(installedAddonKey(' LedgerLink ')).toBe('ledgerlink');
  });
});

describe('toInstalledAddonsView', () => {
  it('maps absent title/version to null and the capture time to ISO', () => {
    const capturedAt = new Date('2026-11-09T12:00:00.000Z');
    const view = toInstalledAddonsView({
      addons: [
        { name: 'Details', title: 'Details!', version: '1.0', loaded: true },
        addon('Bagnon', false),
      ],
      capturedAt,
    });
    expect(view).toEqual({
      capturedAt: '2026-11-09T12:00:00.000Z',
      addons: [
        { name: 'Details', title: 'Details!', version: '1.0', loaded: true },
        { name: 'Bagnon', title: null, version: null, loaded: false },
      ],
    });
  });
});
