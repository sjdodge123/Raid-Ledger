import {
  normalizeRealmName,
  type AddonImportRulesetInferenceDto,
  type AddonWho,
  type WowForeverRealmRulesetEntryDto,
  type WowForeverRealmRulesetsDto,
  type WowForeverRuleset,
  type WowForeverSelectableRuleset,
  type WowRegion,
} from '@raid-ledger/contract';
import { ADDON_REGION_MAP } from './addon-import/addon-import.binding-name';
import { authoritativeSectionIndex } from './addon-import/addon-import.binding-paste';
import type { DecodedAddonPaste } from './addon-import/addon-import.decoder';
import { pasteSections } from './addon-import/addon-import.paste-run';

/**
 * Pure realm → ruleset lookup for the admin-maintained Forever map
 * (ROK-1739 §5.2). Precedence lives here: the export's own `who.ruleset`
 * always wins, so a lookup only happens when the export carried none.
 */

/** `${region}:${normalizeRealmName(realmName)}` → ruleset. */
export type RealmRulesetIndex = ReadonlyMap<string, WowForeverRuleset>;

function indexKey(region: WowRegion, realmName: string): string {
  return `${region}:${normalizeRealmName(realmName)}`;
}

export function buildRealmRulesetIndex(
  entries: readonly WowForeverRealmRulesetEntryDto[],
): RealmRulesetIndex {
  return new Map(
    entries.map((e) => [indexKey(e.region, e.realmName), e.ruleset]),
  );
}

/**
 * The map's ruleset for `who`'s realm, or null when the export already has
 * a ruleset, the region is unknown, the realm name is absent/blank, or the
 * realm is not in the map.
 */
export function inferRuleset(
  who: AddonWho,
  region: WowRegion | undefined,
  index: RealmRulesetIndex,
): AddonImportRulesetInferenceDto | null {
  if (who.ruleset !== null || region === undefined) return null;
  const realmName = who.raw.realmName;
  if (realmName === undefined || realmName.trim() === '') return null;
  const ruleset = index.get(indexKey(region, realmName));
  if (ruleset === undefined) return null;
  return { ruleset, realmName, source: 'realm-map' };
}

/** {@link inferRuleset} on the paste's AUTHORITATIVE section (ROK-1737). */
export function inferForPaste(
  paste: DecodedAddonPaste,
  index: RealmRulesetIndex,
): AddonImportRulesetInferenceDto | null {
  const payloads = pasteSections(paste).map((s) => s.payload);
  const lead = payloads[authoritativeSectionIndex(payloads)];
  if (!lead) return null;
  return inferRuleset(lead.who, ADDON_REGION_MAP[lead.client.region], index);
}

/** The inferred ruleset a CREATE may fall back to — never Hardcore (D6). */
export function createFallbackRuleset(
  inference: AddonImportRulesetInferenceDto | null | undefined,
): WowForeverSelectableRuleset | undefined {
  if (!inference || inference.ruleset === 'hardcore') return undefined;
  return inference.ruleset;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Stored + response order: region, then normalized realm name. */
export function sortRealmRulesets(
  map: WowForeverRealmRulesetsDto,
): WowForeverRealmRulesetsDto {
  const entries = [...map.entries].sort(
    (a, b) =>
      compareText(a.region, b.region) ||
      compareText(
        normalizeRealmName(a.realmName),
        normalizeRealmName(b.realmName),
      ),
  );
  return { entries };
}
