import type { CompanionWebpRef } from './companion-common.schema.js';
import type { Bg3Class, Bg3PartyMember, Bg3SavePayload } from './companion-bg3-save.schema.js';
import type { Bg3RawCharacter, Bg3RawClass, Bg3SaveInfoRaw } from './companion-bg3-save-raw.schema.js';

// ============================================================
// Reference normaliser for `bg3-save` v1 (ROK-1954, spec D6).
//
// The normalisation rules ARE the contract: the Rust collector (D2) and the
// WASM preview (W0) must produce exactly this payload for the same input,
// pinned by the golden `fixtures/saveinfo/<case>.saveinfo.json` →
// `fixtures/<case>.json` pairs. Pure and synchronous: no hashing, no clock,
// no fs, no Node built-ins — browser/WASM-host safe. Everything the file
// does not hold (mtime, campaign key hash, thumbnail ref) comes in `meta`.
// The function does NOT parse; the caller parses the raw file with
// `Bg3SaveInfoRawSchema` and the wire schema validates the output.
// ============================================================

/** Collector-supplied facts the raw `SaveInfo.json` does not contain. */
export interface Bg3SaveNormaliseMeta {
    /** `.lsv` mtime, ISO-8601 UTC (`CompanionTimestampSchema`). */
    readonly savedAt: string;
    /** Lowercase hex SHA-256 of the save-folder name (or GameID), computed by the CALLER — never the raw name. */
    readonly campaignKey: string;
    readonly campaignKeySource: Bg3SavePayload['campaignKeySource'];
    /** Ref to the separately uploaded in-package WebP, or `null` when there is none. */
    readonly thumbnail: CompanionWebpRef | null;
}

/** Raw `{Main, Sub}` → `{main, sub}`; a `""` or absent `Sub` becomes `null`. */
function normaliseClass(raw: Bg3RawClass): Bg3Class {
    const sub = raw.Sub === undefined || raw.Sub === '' ? null : raw.Sub;
    return { main: raw.Main, sub };
}

/** One raw character → a wire member; `Position`/`Subregion`/unknown keys are dropped. */
function normaliseMember(raw: Bg3RawCharacter): Bg3PartyMember {
    return {
        origin: raw.Origin,
        race: raw.Race,
        level: raw.Level,
        xpLevel: raw['Experience Points (Current level)'],
        xpTotal: raw['Experience Points (Total)'],
        classes: (raw.Classes ?? []).map(normaliseClass),
        isSummon: raw.Classes === undefined,
    };
}

/**
 * Normalise a parsed BG3 `SaveInfo.json` into a `bg3-save` v1 payload.
 * `Difficulty[0]` is the difficulty, `Difficulty[1]` the ruleset (`null`
 * for a one-element tuple); party order is save order.
 */
export function normaliseBg3SaveInfo(raw: Bg3SaveInfoRaw, meta: Bg3SaveNormaliseMeta): Bg3SavePayload {
    const [difficulty, ruleset] = raw.Difficulty;
    return {
        saveName: raw['Save Name'],
        savedAt: meta.savedAt,
        campaignKey: meta.campaignKey,
        campaignKeySource: meta.campaignKeySource,
        gameVersion: raw['Game Version'],
        platform: raw.Platform,
        currentLevel: raw['Current Level'],
        difficulty,
        ruleset: ruleset ?? null,
        party: raw['Active Party'].Characters.map(normaliseMember),
        thumbnail: meta.thumbnail,
    };
}
