/**
 * ROK-1854 L3 — reads behind the recipe planner routes. One request = one
 * read-only REPEATABLE READ transaction (`MATERIALS_READ_TX`), so the recipe
 * set, the chest scan, the stock totals and the items catalogue all come
 * from the same committed state (spec §2.5).
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
import {
  MATERIALS_READ_TX,
  MaterialsReader,
} from './valheim-materials.repository';
import {
  claimedProfileSql,
  type MaterialsViewer,
} from './valheim-materials.privacy';

type Db = PostgresJsDatabase<typeof schema>;
type Exec = Db | ValheimLinkTx;
const blobs = schema.valheimLinkBlobs;
/** Aliases `claimedProfileSql` expects (`p` profile, `u` its claimer). */
const p = alias(schema.valheimProfiles, 'p');
const u = alias(schema.users, 'u');

/**
 * ROK-1948 D5: the visible-graph cache fingerprint of a server's profiles —
 * row count + an md5 of every profile's `known_recipes`/`known_items` in id
 * order. It hashes the exact input the pruning reads, so ANY committed write
 * that changes a known list changes it. A timestamp max cannot: `imported_at`
 * is `now()` (transaction START), so an import that started earlier but
 * committed later lands an older stamp and leaves count + max unchanged.
 */
export const PROFILE_FINGERPRINT = sql<string>`count(*)::text || ':' || md5(coalesce(string_agg(${p.id}::text || '=' || ${p.knownRecipes}::text || '|' || ${p.knownItems}::text, ',' order by ${p.id}), ''))`;

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

  /**
   * ROK-1862 D4: `known_recipes` of every profile on `serverId` the viewer
   * validly claims (same rule as personal chests), one array per profile.
   * `[]` = no character; an impersonated session reads nothing.
   */
  async knownRecipesFor(
    serverId: number,
    viewer: Pick<MaterialsViewer, 'id' | 'impersonated'>,
  ): Promise<string[][]> {
    if (viewer.impersonated) return [];
    const rows = await this.db
      .select({ known: p.knownRecipes })
      .from(p)
      .innerJoin(u, eq(u.id, p.claimedBy))
      .where(and(eq(p.pelicanServerId, serverId), claimedProfileSql(viewer.id)))
      .orderBy(asc(p.id));
    return rows.map((r) => r.known);
  }

  /**
   * ROK-1948 D5: `PROFILE_FINGERPRINT` over every profile on `serverId`.
   * No claim filter, no viewer term (D2).
   */
  async profileFingerprint(serverId: number): Promise<string> {
    const [row] = await this.db
      .select({ fp: PROFILE_FINGERPRINT })
      .from(p)
      .where(eq(p.pelicanServerId, serverId));
    return row?.fp ?? '0:0';
  }

  /**
   * ROK-1948 D2: both known lists of EVERY profile on `serverId`, claimed or
   * not — spoiler protection asks what anyone in that world has found, so
   * there is deliberately no `claimedProfileSql` and no viewer parameter.
   * The result is only ever reduced to one server-wide union, never
   * attributed to a character or person.
   */
  async serverKnownLists(
    serverId: number,
  ): Promise<{ knownRecipes: string[]; knownItems: string[] }[]> {
    return this.db
      .select({ knownRecipes: p.knownRecipes, knownItems: p.knownItems })
      .from(p)
      .where(eq(p.pelicanServerId, serverId))
      .orderBy(asc(p.id));
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
