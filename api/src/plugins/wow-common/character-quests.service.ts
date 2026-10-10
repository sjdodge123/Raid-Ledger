/**
 * ROK-1745: quest section of a WoW: Forever character page. Reads the
 * LedgerLink `char` snapshot's `quests` slice and intersects it with the known
 * dungeon-quest table. The raw completed-id list never leaves this service.
 */
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { CharacterQuestsDto } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import * as schema from '../../drizzle/schema';
import {
  buildCharacterQuests,
  type ForeverQuestSnapshotInput,
} from './character-quests.helpers';
import { instanceName } from './dungeon-instance-names';
import { VARIANT_EXPANSIONS, toDto } from './dungeon-quests.helpers';
import type { DungeonQuestDto } from './dungeon-quests.types';
import { loadForeverCharSnapshot } from './forever-char-snapshot.query';

type QuestsSlice = NonNullable<ForeverQuestSnapshotInput['quests']>;

const int = z.number().int();

/** Shape the builder needs; anything else hides the section instead of a 500. */
const QuestsSliceSchema: z.ZodType<QuestsSlice> = z.object({
  completed: z.array(int),
  completedTruncated: z.boolean().optional(),
  inProgress: z.array(
    z.object({
      questId: int,
      title: z.string().optional(),
      objectives: z
        .array(
          z.object({
            text: z.string(),
            done: z.boolean(),
            have: int.optional(),
            need: int.optional(),
          }),
        )
        .optional(),
      dungeonInstanceId: int.optional(),
    }),
  ),
});

/**
 * Validate `data.quests` (schema 2) without depending on the snapshot type,
 * which may predate the ROK-1742 `quests` field. Absent or malformed slices
 * return `undefined` (section hidden).
 */
export function readQuestsSlice(data: unknown): QuestsSlice | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const parsed = QuestsSliceSchema.safeParse(
    (data as { quests?: unknown }).quests,
  );
  return parsed.success ? parsed.data : undefined;
}

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
    const snapshot = await loadForeverCharSnapshot(this.db, id);
    const quests = snapshot ? readQuestsSlice(snapshot.data) : undefined;
    if (!snapshot || !quests) return null;
    const input = { capturedAt: snapshot.capturedAt.toISOString(), quests };
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
