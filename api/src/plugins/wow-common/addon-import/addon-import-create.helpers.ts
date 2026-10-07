import { eq } from 'drizzle-orm';
import type {
  AddonImportTargetDto,
  AddonWho,
  CreateCharacterDto,
  WowForeverRuleset,
  WowForeverSelectableRuleset,
  WowRegion,
} from '@raid-ledger/contract';
import * as schema from '../../../drizzle/schema';
import { WOW_FOREVER_GAME_SLUG } from '../wow-forever-identity.helpers';
import {
  ADDON_REGION_MAP,
  resolveExportName,
  titleCaseClass,
} from './addon-import.binding-name';
import { AddonImportError } from './addon-import.errors';
import type { AddonImportTx } from './addon-import-apply.types';
import type { ImportTarget } from './addon-import.target';

/**
 * ROK-1738 D7 / D13 / A1 — build the core create DTO (and the response's
 * `target`) from an export's AUTHORITATIVE section `who`. Every section's
 * envelope carries `who` (class, level, ruleset), so a guild- or raid-only
 * paste maps exactly like a char paste (ruling Q7).
 */

export const UNSUPPORTED_REGION_MESSAGE =
  "Raid Ledger doesn't support that region.";
export const HARDCORE_CREATE_MESSAGE =
  "Hardcore characters can't be added from an import yet.";

/** The WoW: Forever games row id; missing → `WRONG_GAME`. */
export async function foreverGameId(db: AddonImportTx): Promise<number> {
  const [row] = await db
    .select({ id: schema.games.id })
    .from(schema.games)
    .where(eq(schema.games.slug, WOW_FOREVER_GAME_SLUG))
    .limit(1);
  if (!row) throw new AddonImportError('WRONG_GAME');
  return row.id;
}

/** `client.region` → RL region; 5 (cn) / unknown → `REGION_MISMATCH`. */
export function regionFromExport(clientRegion: number): WowRegion {
  const region = ADDON_REGION_MAP[clientRegion];
  if (!region) {
    throw new AddonImportError('REGION_MISMATCH', UNSUPPORTED_REGION_MESSAGE);
  }
  return region;
}

/** An export the create path accepts: never a Hardcore ruleset (A1). */
export type CreatableWho = AddonWho & {
  ruleset: WowForeverSelectableRuleset | null;
};

/**
 * A1 (ruled: refuse until Hardcore opens) + a usable name. Run on the create
 * path BEFORE any write — dry run included. The update path never calls it.
 */
export function assertCreatable(who: AddonWho): asserts who is CreatableWho {
  if (who.ruleset === 'hardcore') {
    throw new AddonImportError('INVALID_PAYLOAD', HARDCORE_CREATE_MESSAGE);
  }
  if (resolveExportName(who) === '') {
    throw new AddonImportError('INVALID_PAYLOAD');
  }
}

/**
 * D13: the export's ruleset wins (a picked one is ignored); only a null
 * `who.ruleset` consults the pick; neither → `RULESET_REQUIRED`.
 */
export function createRuleset(
  who: AddonWho,
  picked?: WowForeverSelectableRuleset,
): WowForeverSelectableRuleset {
  assertCreatable(who);
  const ruleset = who.ruleset ?? picked;
  if (!ruleset) throw new AddonImportError('RULESET_REQUIRED');
  return ruleset;
}

/**
 * D7 core create DTO. `isMain: false` — core still makes the user's first
 * Forever character main. `level` + `addonGuid` are not core create fields:
 * the binding writes them in the same tx.
 */
export function createDtoFromExport(
  who: AddonWho,
  region: WowRegion,
  gameId: number,
  pickedRuleset?: WowForeverSelectableRuleset,
): CreateCharacterDto {
  return {
    gameId,
    name: resolveExportName(who),
    region,
    ruleset: createRuleset(who, pickedRuleset),
    class: titleCaseClass(who.class),
    isMain: false,
  };
}

/** What a create target became once inserted (apply only). */
export interface CreatedTargetRow {
  id: string;
  ruleset: WowForeverRuleset;
}

/**
 * The response's `target`. Create: the export's name; `ruleset` is the
 * created row's on apply, else `who.ruleset` (null = the web shows the
 * picker; a picked ruleset is never echoed on a dry run). Update: the stored
 * character's id, name and ruleset. Class/level are the export's (the
 * binding writes them onto the row on apply).
 */
export function targetDto(
  target: ImportTarget,
  who: AddonWho,
  region: WowRegion,
  created?: CreatedTargetRow,
): AddonImportTargetDto {
  const shared = { region, class: titleCaseClass(who.class), level: who.level };
  if (target.action === 'update') {
    const { character } = target;
    return {
      ...shared,
      action: 'update',
      characterId: character.id,
      name: character.binding.name,
      ruleset: character.binding.ruleset as WowForeverRuleset | null,
    };
  }
  return {
    ...shared,
    action: 'create',
    characterId: created?.id ?? null,
    name: resolveExportName(who),
    ruleset: created?.ruleset ?? who.ruleset,
  };
}
