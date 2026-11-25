import { and, asc, eq, inArray, isNull, notExists, or, sql } from 'drizzle-orm';
import {
  hubCrosswalkConflicts,
  hubGameIds,
  hubGames,
  type HubConflictPayload,
} from '../drizzle/schema';
import type { HubTx } from './hub-tx';
import type { ItemId } from './item-ids';
import type { StoredProvenance } from './provenance';

/** A stored `hub_game_ids` row, as far as matching needs it. */
export interface StoredId {
  readonly kind: string;
  readonly value: string;
  readonly rlGameId: string;
  readonly provenance: StoredProvenance;
}

export interface NewGame {
  readonly rlGameId: string;
  readonly displayName: string;
  readonly normalizedName: string;
}

/** L7 de-duplication key of an open conflict. */
export interface ConflictKey {
  readonly kind: string;
  readonly value: string;
  readonly existingRlGameId: string;
  readonly proposedRlGameId: string | null;
}

export interface NewConflict extends ConflictKey {
  readonly instanceId: string;
  readonly payload: HubConflictPayload;
}

/** Crosswalk reads/writes bound to one locked transaction (ROK-1673). */
export interface CrosswalkStore {
  findIdOwners(ids: readonly ItemId[]): Promise<StoredId[]>;
  findNameCandidate(
    normalizedName: string,
    kinds: readonly string[],
  ): Promise<string | undefined>;
  insertGame(game: NewGame): Promise<void>;
  insertIds(
    rlGameId: string,
    instanceId: string,
    ids: readonly ItemId[],
  ): Promise<void>;
  raiseProvenance(id: ItemId): Promise<void>;
  bumpSeq(rlGameId: string): Promise<void>;
  openConflictExists(key: ConflictKey): Promise<boolean>;
  insertConflict(conflict: NewConflict): Promise<void>;
}

/** {@link CrosswalkStore} over a Drizzle transaction. */
export class CrosswalkTxStore implements CrosswalkStore {
  constructor(private readonly tx: HubTx) {}

  async findIdOwners(ids: readonly ItemId[]): Promise<StoredId[]> {
    if (ids.length === 0) return [];
    const match = ids.map((i) =>
      and(eq(hubGameIds.kind, i.kind), eq(hubGameIds.value, i.value)),
    );
    return this.tx
      .select({
        kind: hubGameIds.kind,
        value: hubGameIds.value,
        rlGameId: hubGameIds.rlGameId,
        provenance: hubGameIds.provenance,
      })
      .from(hubGameIds)
      .where(or(...match));
  }

  /** Step (c): oldest same-name game holding none of `kinds` (Q3, L9). */
  async findNameCandidate(
    normalizedName: string,
    kinds: readonly string[],
  ): Promise<string | undefined> {
    const sameKind = this.tx
      .select({ one: sql`1` })
      .from(hubGameIds)
      .where(
        and(
          eq(hubGameIds.rlGameId, hubGames.rlGameId),
          inArray(hubGameIds.kind, [...kinds]),
        ),
      );
    const rows = await this.tx
      .select({ rlGameId: hubGames.rlGameId })
      .from(hubGames)
      .where(and(eq(hubGames.normalizedName, normalizedName), notExists(sameKind)))
      .orderBy(asc(hubGames.createdAt), asc(hubGames.rlGameId))
      .limit(1);
    return rows[0]?.rlGameId;
  }

  async insertGame(game: NewGame): Promise<void> {
    await this.tx.insert(hubGames).values({ ...game, nameSource: 'instance' });
  }

  async insertIds(
    rlGameId: string,
    instanceId: string,
    ids: readonly ItemId[],
  ): Promise<void> {
    if (ids.length === 0) return;
    await this.tx.insert(hubGameIds).values(
      ids.map((i) => ({
        kind: i.kind,
        value: i.value,
        rlGameId,
        source: 'instance',
        provenance: i.provenance,
        firstContributorInstanceId: instanceId,
      })),
    );
  }

  async raiseProvenance(id: ItemId): Promise<void> {
    await this.tx
      .update(hubGameIds)
      .set({ provenance: id.provenance })
      .where(and(eq(hubGameIds.kind, id.kind), eq(hubGameIds.value, id.value)));
  }

  /** L6: a game's ids changed → it takes the next delta-cursor value. */
  async bumpSeq(rlGameId: string): Promise<void> {
    await this.tx
      .update(hubGames)
      .set({ updatedSeq: sql`nextval('hub_games_updated_seq')` })
      .where(eq(hubGames.rlGameId, rlGameId));
  }

  async openConflictExists(key: ConflictKey): Promise<boolean> {
    const c = hubCrosswalkConflicts;
    const proposed =
      key.proposedRlGameId === null
        ? isNull(c.proposedRlGameId)
        : eq(c.proposedRlGameId, key.proposedRlGameId);
    const rows = await this.tx
      .select({ id: c.id })
      .from(c)
      .where(
        and(
          eq(c.kind, key.kind),
          eq(c.value, key.value),
          eq(c.existingRlGameId, key.existingRlGameId),
          proposed,
          isNull(c.resolvedAt),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  async insertConflict(conflict: NewConflict): Promise<void> {
    await this.tx.insert(hubCrosswalkConflicts).values(conflict);
  }
}
