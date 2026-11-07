/**
 * ROK-1745: quest section of a WoW: Forever character page. Reads the
 * LedgerLink `char` snapshot's `quests` slice (or, ROK-2109, the Armory
 * `quests/completed` list when newer) and intersects it with the known
 * dungeon-quest table. The raw completed-id list never leaves this service.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterQuestsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import { buildCharacterQuests } from './character-quests.helpers';
import { instanceName } from './dungeon-instance-names';
import { VARIANT_EXPANSIONS, toDto } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { readQuestsSlice } from './forever-quest-source.helpers';
import { loadForeverQuestSources } from './forever-quest-source.query';

/** Re-exported: the slice reader moved beside the effective helper (ROK-2109). */
export { readQuestsSlice };

@Injectable()
export class CharacterQuestsService {
  constructor(
    @Inject(DrizzleAsyncProvider)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  /** @returns the quest DTO, or null when the section is hidden (D2). */
  async getForCharacter(id: string): Promise<CharacterQuestsDto | null> {
    const [row] = await this.db
      .select({ id: schema.characters.id })
      .from(schema.characters)
      .where(eq(schema.characters.id, id))
      .limit(1);
    if (!row) throw new NotFoundException(`Character ${id} not found`);
    const eff = (await loadForeverQuestSources(this.db, [id])).get(id);
    if (!eff) return null;
    const input = {
      capturedAt: eff.capturedAt.toISOString(),
      quests: eff.quests,
      source: eff.source,
      inProgressSyncedAt: eff.inProgressAsOf?.toISOString() ?? null,
    };
    return buildCharacterQuests(input, await this.loadKnown(), instanceName);
  }

  /** Known dungeon quests for the Forever variant (D5). */
  private async loadKnown(): Promise<DungeonQuestDto[]> {
    const rows = await this.db
      .select()
      .from(schema.wowClassicDungeonQuests)
      .where(
        inArray(
          schema.wowClassicDungeonQuests.expansion,
          VARIANT_EXPANSIONS.wow_forever ?? [],
        ),
      );
    return rows.map(toDto);
  }
}
