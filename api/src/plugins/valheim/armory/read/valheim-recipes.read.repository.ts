/**
 * ROK-1854 L3 — reads behind the recipe planner routes. One request = one
 * read-only REPEATABLE READ transaction (`MATERIALS_READ_TX`), so the recipe
 * set, the chest scan, the stock totals and the items catalogue all come
 * from the same committed state (spec §2.5).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { ValheimMapBaseMap } from '@raid-ledger/contract';
import { DrizzleAsyncProvider } from '../../../../drizzle/drizzle.module';
import * as schema from '../../../../drizzle/schema';
import type { ValheimLinkTx } from '../../link/valheim-link-token-lock';
import {
  findLatestRecipeSet,
  loadRecipeSetRows,
  type RecipeSetRows,
} from '../valheim-recipes.repository';
import { MATERIALS_READ_TX, MaterialsReader } from './valheim-materials.repository';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const blobs = schema.valheimLinkBlobs;

@Injectable()
export class ValheimRecipesReadRepository {
  constructor(@Inject(DrizzleAsyncProvider) private readonly db: Db) {}

  /** Run `fn`'s reads in one read-only REPEATABLE READ transaction. */
  read<T>(fn: (reader: RecipesReader) => Promise<T>): Promise<T> {
    return this.db.transaction(
      (tx) => fn(new RecipesReader(tx)),
      MATERIALS_READ_TX,
    );
  }
}

/** Recipe-set reads + the Materials queries, bound to one executor. */
export class RecipesReader {
  /** Chest scan, stock totals and the items catalogue (same transaction). */
  readonly materials: MaterialsReader;

  constructor(private readonly db: Exec) {
    this.materials = new MaterialsReader(db);
  }

  /** D6: the server's set with the newest `captured_at`, or null. */
  latestSet(serverId: number): Promise<schema.ValheimRecipeSetRow | null> {
    return findLatestRecipeSet(this.db, serverId);
  }

  /** The set's five child tables (for the in-memory graph, D5). */
  loadRows(setId: number): Promise<RecipeSetRows> {
    return loadRecipeSetRows(this.db, setId);
  }

  /** The set's icon atlas; `ready` = its PNG blob is stored. */
  async recipeAtlas(
    set: schema.ValheimRecipeSetRow,
  ): Promise<ValheimMapBaseMap | null> {
    const { atlasSha256: sha256, atlasWidth: width } = set;
    const height = set.atlasHeight;
    if (sha256 === null || width === null || height === null) return null;
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(blobs)
      .where(
        and(
          eq(blobs.pelicanServerId, set.pelicanServerId),
          eq(blobs.sha256, sha256),
        ),
      )
      .limit(1);
    return { sha256, width, height, ready: row !== undefined };
  }
}
