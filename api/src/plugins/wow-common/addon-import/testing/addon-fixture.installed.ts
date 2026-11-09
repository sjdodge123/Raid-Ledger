import { createHash } from 'node:crypto';
import {
  ADDON_INSTALLED_MAX,
  ADDON_INSTALLED_NAME_MAX,
  ADDON_INSTALLED_TITLE_MAX,
  ADDON_INSTALLED_VERSION_MAX,
  type AddonCharExport,
  type AddonInstalledList,
} from '@raid-ledger/contract';
import { buildCharPayload } from './addon-fixture.builder';

/**
 * ROK-2147 golden-fixture builders for the optional `char` `data.addons`
 * installed-addon list (CONTRACT.md §3.2). Synthetic, public addon folder
 * names only — no player data. Loaded entries first, as the addon emits them.
 */
export function buildInstalledAddons(): AddonInstalledList {
  return [
    {
      name: 'LedgerLink',
      title: '|cff33ff99Ledger|rLink',
      version: '1.4.0',
      loaded: true,
    },
    {
      name: 'Details',
      title: 'Details! Damage Meter',
      version: '1.15.7.142',
      loaded: true,
    },
    { name: 'WeakAuras', title: 'WeakAuras', version: '5.19.2', loaded: true },
    { name: 'DBM-Core', title: 'Deadly Boss Mods Core', loaded: true },
    { name: 'Questie', loaded: true },
    {
      name: 'DBM-StatusBarTimers',
      title: 'DBM Status Bar Timers',
      version: '1.15.10',
      loaded: false,
    },
  ];
}

/** `char-installed-addons`: the default char export + six installed addons. */
export function buildCharInstalledAddonsPayload(
  addons: AddonInstalledList = buildInstalledAddons(),
): AddonCharExport {
  const payload = buildCharPayload();
  return { ...payload, data: { ...payload.data, addons } };
}

/** A char export whose list breaks the contract (invalid fixtures only). */
function withInvalidAddons(addons: object[]): object {
  const payload = buildCharPayload();
  return { ...payload, data: { ...payload.data, addons } };
}

/** Deterministic high-entropy string (hex) of exactly `len` characters. */
function noise(seed: string, len: number): string {
  let out = '';
  for (let i = 0; out.length < len; i++) {
    out += createHash('sha256').update(`${seed}:${i}`).digest('hex');
  }
  return out.slice(0, len);
}

/** 500 entries, every string at its cap, hard to compress (size check). */
export function buildInstalledAddonsWorstCase(): AddonInstalledList {
  return Array.from({ length: ADDON_INSTALLED_MAX }, (_, i) => ({
    name: noise(`n${i}`, ADDON_INSTALLED_NAME_MAX),
    title: noise(`t${i}`, ADDON_INSTALLED_TITLE_MAX),
    version: noise(`v${i}`, ADDON_INSTALLED_VERSION_MAX),
    loaded: i % 3 !== 0,
  }));
}

/** Invalid: 501 entries (cap is 500). */
export function buildCharAddonsTooManyPayload(): object {
  const addons = Array.from({ length: ADDON_INSTALLED_MAX + 1 }, (_, i) => ({
    name: `Addon${i + 1}`,
    loaded: true,
  }));
  return withInvalidAddons(addons);
}

/** Invalid: a 65-character folder name (cap is 64). */
export function buildCharAddonsNameTooLongPayload(): object {
  const addons = [
    ...buildInstalledAddons(),
    { name: 'A'.repeat(ADDON_INSTALLED_NAME_MAX + 1), loaded: false },
  ];
  return withInvalidAddons(addons);
}
