import type {
  AddonImportDiff,
  AddonImportWarning,
  AddonWho,
  WowForeverRuleset,
} from '@raid-ledger/contract';
import { WOW_FOREVER_GAME_SLUG } from '../../../characters/characters-forever.helpers';
import { AddonImportError } from './addon-import.errors';
import {
  ADDON_REGION_MAP,
  buildAddCharacterPrefill,
  resolveExportName,
  sameName,
  titleCaseClass,
} from './addon-import.binding-name';

/**
 * ROK-1724 §4.3 Binding — pure: decides whether a decoded export may land on
 * this RL character and what the apply would change on the character row.
 * No DB access; the "GUID already linked to ANOTHER character" check needs
 * the unique index and lives in `assertGuidFree` (char apply).
 */

/** The RL character fields the binding reads (B3 builds this). */
export interface AddonBindingCharacter {
  gameSlug: string;
  name: string;
  region: string | null;
  ruleset: string | null;
  class: string | null;
  level: number | null;
  addonGuid: string | null;
}

/** Only the envelope fields every section shares. */
export interface AddonBindingPayload {
  client: { region: number };
  who: AddonWho;
}

export interface AddonBindingOptions {
  /** Preview (`true`) never raises `GUID_CONFIRM_REQUIRED`. */
  dryRun: boolean;
  confirm?: { updateRuleset?: boolean; repinGuid?: boolean };
}

export interface AddonBindingResult {
  /** Rejects in check order; the service throws `errors[0]`. */
  errors: AddonImportError[];
  warnings: AddonImportWarning[];
  diff: AddonImportDiff;
  /** GUID to write to `characters.addon_guid` on apply; null = unchanged. */
  pinGuid: string | null;
  /** Ruleset to write on apply; undefined = unchanged. */
  setRuleset?: WowForeverRuleset;
}

/** Game → region → name. Returns the first reject, or null. */
function identityError(
  payload: AddonBindingPayload,
  character: AddonBindingCharacter,
): AddonImportError | null {
  if (character.gameSlug !== WOW_FOREVER_GAME_SLUG) {
    return new AddonImportError('WRONG_GAME');
  }
  const region = ADDON_REGION_MAP[payload.client.region];
  if (!region || region !== character.region) {
    return new AddonImportError('REGION_MISMATCH');
  }
  const exportName = resolveExportName(payload.who);
  if (!sameName(exportName, character.name)) {
    return new AddonImportError('NAME_MISMATCH', undefined, {
      addCharacter: buildAddCharacterPrefill(payload.who, exportName, region),
    });
  }
  return null;
}

/** Class/level drift → auto-update diff (+ one warning). */
function classLevelDiff(
  who: AddonWho,
  character: AddonBindingCharacter,
): AddonImportDiff {
  const diff: AddonImportDiff = {};
  const cls = titleCaseClass(who.class);
  if ((character.class ?? '').toLowerCase() !== cls.toLowerCase()) {
    diff.class = { from: character.class, to: cls };
  }
  if (character.level !== who.level) {
    diff.level = { from: character.level, to: who.level };
  }
  return diff;
}

/** GUID rule: null → pin; equal → ok; different → warn (+ confirm on apply). */
function guidOutcome(
  who: AddonWho,
  character: AddonBindingCharacter,
  opts: AddonBindingOptions,
  result: AddonBindingResult,
): void {
  if (character.addonGuid === who.guid) return;
  if (character.addonGuid === null) {
    result.pinGuid = who.guid;
    return;
  }
  result.warnings.push({
    code: 'GUID_CHANGED',
    from: character.addonGuid,
    to: who.guid,
  });
  if (opts.confirm?.repinGuid) {
    result.pinGuid = who.guid;
  } else if (!opts.dryRun) {
    result.errors.push(new AddonImportError('GUID_CONFIRM_REQUIRED'));
  }
}

/**
 * Ruleset: a null `who.ruleset` means the addon could not tell — never a
 * change. A differing one warns; it is written only with `updateRuleset`.
 */
function rulesetOutcome(
  who: AddonWho,
  character: AddonBindingCharacter,
  opts: AddonBindingOptions,
  result: AddonBindingResult,
): void {
  if (who.ruleset === null || who.ruleset === character.ruleset) return;
  result.warnings.push({
    code: 'RULESET_CHANGED',
    from: character.ruleset,
    to: who.ruleset,
  });
  if (opts.confirm?.updateRuleset) result.setRuleset = who.ruleset;
}

export function bindToCharacter(
  payload: AddonBindingPayload,
  character: AddonBindingCharacter,
  opts: AddonBindingOptions,
): AddonBindingResult {
  const result: AddonBindingResult = {
    errors: [],
    warnings: [],
    diff: {},
    pinGuid: null,
  };
  const identity = identityError(payload, character);
  if (identity) {
    result.errors.push(identity);
    return result;
  }
  rulesetOutcome(payload.who, character, opts, result);
  guidOutcome(payload.who, character, opts, result);
  result.diff = classLevelDiff(payload.who, character);
  if (result.diff.class || result.diff.level) {
    result.warnings.push({ code: 'CLASS_LEVEL_UPDATED' });
  }
  return result;
}
