/**
 * Reading the admin JWT back out of Playwright's saved storageState (ROK-1466).
 *
 * Two specs needed the raw token for direct API calls and each picked the
 * origin entry with `o.origin.includes('localhost')`. Against a fleet env the
 * saved origin is `http://rl-env-<slug>-allinone`, so the lookup returned
 * `undefined`, the token came back `null`, and the spec quietly took its
 * "no token" branch instead of failing — a smoke test that stops testing.
 *
 * Origin matching is now derived from the resolved web target, with a fallback
 * to any origin that actually carries the token, so the helper is correct for
 * local dev, a local allinone, and a fleet env alike.
 */
import fs from 'fs';
import { STORAGE_STATE_PATH } from '../auth-paths';
import { resolveWebUrl } from './target';

/** localStorage key written by `use-auth.ts` and by global setup. */
export const TOKEN_KEY = 'raid_ledger_token';

/** The subset of Playwright's storageState file this module reads. */
export interface StorageStateShape {
    origins?: Array<{
        origin: string;
        localStorage?: Array<{ name: string; value: string }>;
    }>;
}

/** The origin part of a URL, or the input unchanged if it will not parse. */
function originOf(url: string): string {
    try {
        return new URL(url).origin;
    } catch {
        return url;
    }
}

/**
 * Pick the admin JWT out of an already-parsed storageState object.
 *
 * @param state - Parsed contents of `scripts/.auth/admin.json`.
 * @param webUrl - The web target the state was captured against.
 * @returns The JWT, or null when no origin carries one.
 */
export function pickTokenFromState(
    state: StorageStateShape,
    webUrl: string = resolveWebUrl(),
): string | null {
    const origins = state.origins ?? [];
    const wanted = originOf(webUrl);
    const tokenOf = (o: (typeof origins)[number]): string | null =>
        o.localStorage?.find((e) => e.name === TOKEN_KEY)?.value ?? null;

    const exact = origins.find((o) => originOf(o.origin) === wanted);
    if (exact) {
        const token = tokenOf(exact);
        if (token) return token;
    }
    // Fallback: any origin that carries the key. Covers a state file captured
    // against a different host (e.g. a redirect) without silently returning null.
    for (const o of origins) {
        const token = tokenOf(o);
        if (token) return token;
    }
    return null;
}

/**
 * Read the admin JWT from the storageState file written by global setup.
 *
 * @param filePath - Override for the state file location (tests).
 * @returns The JWT, or null when the file is missing/unparsable/tokenless.
 */
export function readTokenFromStorageState(
    filePath: string = STORAGE_STATE_PATH,
): string | null {
    try {
        const state = JSON.parse(
            fs.readFileSync(filePath, 'utf-8'),
        ) as StorageStateShape;
        return pickTokenFromState(state);
    } catch {
        return null;
    }
}
