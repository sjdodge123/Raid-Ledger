/**
 * Runtime resolution of the WoW: Forever Blizzard namespace prefix (ROK-1717).
 *
 * `classicforever` is the value stored on the Forever games row and returned by
 * `variantToNamespacePrefix('wow_forever')`. It is an ALIAS: only at the
 * Blizzard-call edge (`getNamespacePrefixes`) is it swapped for the
 * admin-configured prefix, so the games row, the boot re-seed and every web
 * mapping keyed on `classicforever` stay untouched.
 *
 * Module state on purpose: the edge is a pure sync helper with no DI, and prod
 * is a single process. `ForeverConfigService` sets it on boot and on change.
 *
 * Must NOT import from `blizzard.constants.ts` (that file imports this one).
 */

/** The stored alias, and the prefix used when no admin override is set. */
export const FOREVER_NAMESPACE_ALIAS = 'classicforever';

let currentPrefix: string = FOREVER_NAMESPACE_ALIAS;

/**
 * Set the admin-configured Forever prefix; `null`/empty restores the default.
 * @param prefix - Blizzard namespace prefix without `static-`/`-us` parts.
 */
export function setForeverNamespacePrefix(prefix: string | null): void {
  currentPrefix = prefix || FOREVER_NAMESPACE_ALIAS;
}

/** The Forever prefix Blizzard calls currently use. */
export function getForeverNamespacePrefix(): string {
  return currentPrefix;
}

/**
 * Resolve a stored namespace prefix to the one sent to Blizzard: the Forever
 * alias maps to the current prefix; anything else (and null = retail) passes
 * through unchanged.
 * @param stored - The game row's `api_namespace_prefix`.
 */
export function resolveBlizzardNamespacePrefix(
  stored: string | null,
): string | null {
  return stored === FOREVER_NAMESPACE_ALIAS ? currentPrefix : stored;
}
