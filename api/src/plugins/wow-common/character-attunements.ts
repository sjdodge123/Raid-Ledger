import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { WowCharacterAttunementDto } from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import {
  appliesTo,
  attunementChecklist,
  evaluateAttunement,
  factionOfRace,
  isBelowLevel,
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
  return visibleDefs(defs, confirmed)
    .filter((v) => v.def.trackable && appliesTo(v.def, input.faction))
    .map((v) => {
      const { state, nextStep } = evaluateAttunement(v, input.quests);
      return {
        key: v.def.key,
        groupKey: v.def.groupKey,
        instance: v.def.instance,
        state,
        belowLevel: isBelowLevel(v, input.level),
        requiredLevel: v.minLevel,
        nextStep,
        steps: attunementChecklist(v, input.quests),
      };
    });
}

/** A stored faction column ("Horde", "alliance") → its side; else null. */
function sideOf(faction: string | null): AttunementFactionSide | null {
  const key = faction?.trim().toLowerCase();
  return key === 'horde' || key === 'alliance' ? key : null;
}

/** Loads the confirmed ids and the character's race/faction/level. */
export async function loadCharacterAttunements(
  db: Db,
  characterId: string,
  quests: EffectiveQuests,
): Promise<WowCharacterAttunementDto[]> {
  const confirmed = await loadConfirmedAttunementIds(db);
  if (confirmed.size === 0) return [];
  const c = schema.characters;
  const [row] = await db
    .select({ race: c.race, faction: c.faction, level: c.level })
    .from(c)
    .where(eq(c.id, characterId))
    .limit(1);
  const faction = factionOfRace(row?.race) ?? sideOf(row?.faction ?? null);
  return computeCharacterAttunements(FOREVER_ATTUNEMENTS, confirmed, {
    faction,
    level: row?.level ?? null,
    quests,
  });
}
