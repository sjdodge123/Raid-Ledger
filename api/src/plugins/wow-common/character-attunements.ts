import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowCharacterAttunementDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  appliesTo,
  attunementChecklist,
  evaluateAttunement,
  factionOfColumn,
  factionOfRace,
  isBelowLevel,
  prepareQuests,
  visibleDefs,
  type AttunementFactionSide,
} from './attunement-evaluate';
import {
  FOREVER_ATTUNEMENTS,
  type AttunementDef,
} from './data/forever-attunements';
import type { EffectiveQuests } from './forever-quest-source.helpers';
import { loadConfirmedAttunementIds } from './guilds/roster-insights/roster-insights.attunements.query';

type Db = PostgresJsDatabase<typeof schema>;

/**
 * ROK-1927 (§5.3) — the character page's own attunement checklists, from the
 * same evaluator as the roster section. Only tracked defs of the character's
 * faction (unknown → `both` defs only) whose final quest Blizzard confirmed;
 * only confirmed steps. Attached wherever the Quests section is shown.
 */

export interface CharacterAttunementInput {
  faction: AttunementFactionSide | null;
  level: number | null;
  quests: EffectiveQuests;
}

/** Pure: one character's checklists over the visible tracked defs. */
export function computeCharacterAttunements(
  defs: readonly AttunementDef[],
  confirmed: ReadonlySet<number>,
  input: CharacterAttunementInput,
): WowCharacterAttunementDto[] {
  const prepared = prepareQuests(input.quests);
  return visibleDefs(defs, confirmed)
    .filter((v) => v.def.trackable && appliesTo(v.def, input.faction))
    .map((v) => {
      const { state, nextStep } = evaluateAttunement(v, input.quests, prepared);
      return {
        key: v.def.key,
        groupKey: v.def.groupKey,
        instance: v.def.instance,
        state,
        belowLevel: isBelowLevel(v, input.level),
        requiredLevel: v.minLevel,
        nextStep,
        steps: attunementChecklist(v, input.quests, prepared),
      };
    });
}

/** The character columns the faction and level gate read. */
export interface CharacterAttunementRow {
  race: string | null;
  faction: string | null;
  level: number | null;
}

/**
 * Loads the confirmed ids; the caller passes the character row it already
 * read (review NIT-1: one character read per request).
 */
export async function loadCharacterAttunements(
  db: Db,
  row: CharacterAttunementRow,
  quests: EffectiveQuests,
): Promise<WowCharacterAttunementDto[]> {
  const confirmed = await loadConfirmedAttunementIds(db);
  if (confirmed.size === 0) return [];
  const faction = factionOfRace(row.race) ?? factionOfColumn(row.faction);
  return computeCharacterAttunements(FOREVER_ATTUNEMENTS, confirmed, {
    faction,
    level: row.level,
    quests,
  });
}
