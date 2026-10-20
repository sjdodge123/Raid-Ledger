import { z } from 'zod';
import { WowForeverRulesetSchema } from './blizzard.schema.js';
import { WowRegionSchema } from './characters.schema.js';

// ============================================================
// WoW: Forever realm → ruleset map (ROK-1739)
// Admin-maintained; fills a character's ruleset on addon import when the
// LedgerLink export carries `who.ruleset: null`.
// ============================================================

/** Most rows the admin map accepts. */
export const WOW_FOREVER_REALM_RULESETS_MAX = 500;

/**
 * Apostrophe look-alikes (curly quotes from iPad/macOS smart punctuation, the
 * modifier letter, backtick, acute). Replaced BEFORE NFKC: NFKC leaves the first
 * four alone but decomposes U+00B4 into a space + combining accent (Codex r1 P3) — `GetRealmName()` sends a
 * straight `'`, so "Kel’Thuzad" typed by an admin must key like "Kel'Thuzad".
 */
const REALM_APOSTROPHES = /[\u2018\u2019\u02BC\u0060\u00B4]/g;

/**
 * Canonical realm-name key: apostrophe look-alikes → `'`, then NFKC, trimmed, inner whitespace collapsed,
 * lowercased. The one definition shared by the API lookup and the web
 * duplicate check.
 */
export function normalizeRealmName(name: string): string {
    return name
        .replace(REALM_APOSTROPHES, "'")
        .normalize('NFKC')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

export const WowForeverRealmRulesetEntrySchema = z
    .object({
        region: WowRegionSchema,
        realmName: z.string().trim().min(1).max(100),
        /** Full enum — Hardcore realms map to `hardcore`. */
        ruleset: WowForeverRulesetSchema,
    })
    .strict();
export type WowForeverRealmRulesetEntryDto = z.infer<typeof WowForeverRealmRulesetEntrySchema>;

/** Request AND response body; responses are sorted by region, then realm name. */
export const WowForeverRealmRulesetsSchema = z
    .object({
        entries: z.array(WowForeverRealmRulesetEntrySchema).max(WOW_FOREVER_REALM_RULESETS_MAX),
    })
    .strict()
    .superRefine((value, ctx) => {
        const seen = new Set<string>();
        value.entries.forEach((entry, i) => {
            const key = `${entry.region}:${normalizeRealmName(entry.realmName)}`;
            if (seen.has(key)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['entries', i, 'realmName'],
                    message: 'Duplicate realm for this region',
                });
            }
            seen.add(key);
        });
    });
export type WowForeverRealmRulesetsDto = z.infer<typeof WowForeverRealmRulesetsSchema>;
