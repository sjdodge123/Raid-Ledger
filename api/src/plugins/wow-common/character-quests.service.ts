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
import { SettingsService } from '../../settings/settings.service';
import { loadCharacterAttunements } from './character-attunements';
import { buildCharacterQuests } from './character-quests.helpers';
import { instanceName } from './dungeon-instance-names';
import { VARIANT_EXPANSIONS, toDto } from './dungeon-quests.helpers';
import { applyKnownQuestOverlay } from './dungeon-quests.overlay';
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
    private readonly settings: SettingsService,
  ) {}

  /** @returns the quest DTO, or null when the section is hidden (D2). */
  async getForCharacter(id: string): Promise<CharacterQuestsDto | null> {
    const [row] = await this.db
      .select({
        race: schema.characters.race,
        faction: schema.characters.faction,
        level: schema.characters.level,
      })
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
    const dto = buildCharacterQuests(
      input,
      await this.loadKnown(),
      instanceName,
    );
    if (!dto) return null;
    // ROK-1927: the own attunement checklists ride on the same visibility.
    const attunements = await loadCharacterAttunements(this.db, row, eff);
    return { ...dto, attunements };
  }

  /**
   * Known dungeon quests for the Forever variant (D5), with the switch-aware
   * Blizzard overlay (ROK-2143): Blizzard titles, overlay-only dungeon quests
   * and their prerequisites — the same set Quest Prep progress uses.
   */
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
    const deps = { db: this.db, settings: this.settings };
    return applyKnownQuestOverlay(deps, rows.map(toDto));
  }
}
