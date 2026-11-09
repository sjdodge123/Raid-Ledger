import type {
  AddonInstalled,
  CharacterInstalledAddon,
  CharacterInstalledAddonsResponse,
} from '@raid-ledger/contract';

/**
 * ROK-2147 — pure helpers for the `char` export's installed-addon list
 * (`data.addons`): the decoder's de-duplication and the read DTO mapping.
 */

/** Folder-name key: matching and de-duplication are case-insensitive. */
export function installedAddonKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Drop duplicate folder names (case-insensitive) keeping the FIRST — the
 * addon sends loaded entries first — and any name the sanitizer emptied.
 * Never a reject: a duplicate is the client's quirk, not a bad export.
 */
export function dedupeInstalled(
  list: readonly AddonInstalled[],
): AddonInstalled[] {
  const seen = new Set<string>();
  const out: AddonInstalled[] = [];
  for (const addon of list) {
    const key = installedAddonKey(addon.name);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(addon);
  }
  return out;
}

/** One stored entry as the read API returns it (absent → null). */
export function toCharacterInstalledAddon(
  addon: AddonInstalled,
): CharacterInstalledAddon {
  return {
    name: addon.name,
    title: addon.title ?? null,
    version: addon.version ?? null,
    loaded: addon.loaded,
  };
}

/** A stored row → the response's `installed` object. */
export function toInstalledAddonsView(row: {
  addons: readonly AddonInstalled[];
  capturedAt: Date;
}): NonNullable<CharacterInstalledAddonsResponse['installed']> {
  return {
    addons: row.addons.map(toCharacterInstalledAddon),
    capturedAt: row.capturedAt.toISOString(),
  };
}
