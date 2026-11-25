import { Inject, Injectable } from '@nestjs/common';
import {
  normalizeForDedup,
  type CrosswalkContributionItem,
  type CrosswalkContributionResult,
} from '@raid-ledger/contract';
import { CrosswalkLock } from './crosswalk-lock';
import type { CrosswalkStore } from './crosswalk.repository';
import { itemIds, lockKeysFor, type ItemId } from './item-ids';
import {
  planAgainstOwners,
  resolveResult,
  type ConflictPlan,
  type ItemOutcome,
  type ItemPlan,
} from './match-plan';
import { mintUlid } from './ulid';

interface ItemContext {
  readonly instanceId: string;
  readonly item: CrosswalkContributionItem;
}

/** Matches contributed items into the hub crosswalk (ROK-1673, §7 RH-4a). */
@Injectable()
export class CrosswalkMatcherService {
  constructor(
    @Inject(CrosswalkLock) private readonly lock: Pick<CrosswalkLock, 'run'>,
  ) {}

  /** One locked transaction per item, sequentially; results keep item order. */
  async matchBatch(
    instanceId: string,
    items: readonly CrosswalkContributionItem[],
  ): Promise<CrosswalkContributionResult[]> {
    const results: CrosswalkContributionResult[] = [];
    for (const item of items) {
      const ctx: ItemContext = { instanceId, item };
      const outcome = await this.lock.run(lockKeysFor(item), (store) =>
        this.matchItem(store, ctx),
      );
      results.push(resolveResult(item.clientRef, outcome));
    }
    return results;
  }

  private async matchItem(
    store: CrosswalkStore,
    ctx: ItemContext,
  ): Promise<ItemOutcome> {
    const ids = itemIds(ctx.item);
    const plan = planAgainstOwners(ids, await store.findIdOwners(ids));
    if (plan) return this.applyPlan(store, ctx, plan);
    const candidate = await this.findCandidate(store, ctx.item, ids);
    if (candidate !== undefined) {
      const attachAll = {
        rlGameId: candidate,
        attach: ids,
        raise: [],
        conflicts: [],
      };
      return this.applyPlan(store, ctx, attachAll);
    }
    return this.createGame(store, ctx, ids);
  }

  /** Step (c); an empty normalized name skips it (L11). */
  private async findCandidate(
    store: CrosswalkStore,
    item: CrosswalkContributionItem,
    ids: readonly ItemId[],
  ): Promise<string | undefined> {
    const normalized = normalizeForDedup(item.name);
    if (normalized === '') return undefined;
    return store.findNameCandidate(
      normalized,
      ids.map((i) => i.kind),
    );
  }

  private async applyPlan(
    store: CrosswalkStore,
    ctx: ItemContext,
    plan: ItemPlan,
  ): Promise<ItemOutcome> {
    await store.insertIds(plan.rlGameId, ctx.instanceId, plan.attach);
    for (const id of plan.raise) await store.raiseProvenance(id);
    const changed = plan.attach.length + plan.raise.length > 0;
    if (changed) await store.bumpSeq(plan.rlGameId);
    for (const c of plan.conflicts) await this.recordConflict(store, ctx, c);
    const conflict = plan.conflicts.length > 0;
    return { rlGameId: plan.rlGameId, created: false, changed, conflict };
  }

  /** L7: an identical open conflict is not written twice. */
  private async recordConflict(
    store: CrosswalkStore,
    ctx: ItemContext,
    c: ConflictPlan,
  ): Promise<void> {
    const { kind, value, provenance } = c.id;
    const key = {
      kind,
      value,
      existingRlGameId: c.existingRlGameId,
      proposedRlGameId: c.proposedRlGameId,
    };
    if (await store.openConflictExists(key)) return;
    const payload = { clientRef: ctx.item.clientRef, kind, value, provenance };
    await store.insertConflict({ ...key, instanceId: ctx.instanceId, payload });
  }

  /** Step (d): mint a ULID; the first contribution's name is kept (L11). */
  private async createGame(
    store: CrosswalkStore,
    ctx: ItemContext,
    ids: readonly ItemId[],
  ): Promise<ItemOutcome> {
    const rlGameId = mintUlid();
    const { name } = ctx.item;
    const normalizedName = normalizeForDedup(name);
    await store.insertGame({ rlGameId, displayName: name, normalizedName });
    await store.insertIds(rlGameId, ctx.instanceId, ids);
    return { rlGameId, created: true, changed: false, conflict: false };
  }
}
