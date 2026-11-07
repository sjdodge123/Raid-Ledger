/**
 * Runtime resolution of the WoW: Forever Blizzard namespace prefix (ROK-1717,
 * ROK-2102).
 *
 * `classicforever` is the value stored on the Forever games row and returned by
 * `variantToNamespacePrefix('wow_forever')`. It is a SENTINEL, never sent to
 * Blizzard by default (it answers 403): only at the Blizzard-call edge
 * (`getNamespacePrefixes`) is it swapped for the admin override, or for
 * {@link FOREVER_DEFAULT_PREFIX} when none is set. The games row, the boot
 * re-seed and every web mapping keyed on `classicforever` stay untouched.
 *
 * Module state on purpose: the edge is a pure sync helper with no DI, and prod
 * is a single process. `ForeverConfigService` sets it on boot and on change.
 *
 * Must NOT import from `blizzard.constants.ts` (that file imports this one).
 */

/** The stored sentinel on the games row; resolved at the Blizzard-call edge. */
export const FOREVER_NAMESPACE_ALIAS = 'classicforever';

/**
 * The prefix Forever calls use when no admin override is set. Confirmed by the
 * ROK-2102 probe 2026-11-06: `static-forever-{us,eu,kr,tw}` answers 200.
 */
export const FOREVER_DEFAULT_PREFIX = 'forever';

let currentPrefix: string = FOREVER_DEFAULT_PREFIX;

/**
 * Set the admin-configured Forever prefix. `null`, empty and the alias itself
 * restore {@link FOREVER_DEFAULT_PREFIX} (sending the alias is a proven 403).
 * @param prefix - Blizzard namespace prefix without `static-`/`-us` parts.
 */
export function setForeverNamespacePrefix(prefix: string | null): void {
  currentPrefix =
    prefix && prefix !== FOREVER_NAMESPACE_ALIAS
      ? prefix
      : FOREVER_DEFAULT_PREFIX;
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
