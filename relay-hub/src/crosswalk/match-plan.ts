import type { CrosswalkContributionResult } from '@raid-ledger/contract';
import type { StoredId } from './crosswalk.repository';
import type { ItemId } from './item-ids';
import { shouldRaise } from './provenance';

/**
 * An id another game owns; recorded, never applied. Direction follows AC 4:
 * `existingRlGameId` is the game the item resolved to, `proposedRlGameId` is
 * the id's current owner (RH-4b's admin view labels the columns this way).
 */
export interface ConflictPlan {
  readonly id: ItemId;
  /** The game the contributed item resolved to. */
  readonly existingRlGameId: string;
  /** The game that currently owns `id`. */
  readonly proposedRlGameId: string;
}

/** What to write for an item that resolved to `rlGameId`. */
export interface ItemPlan {
  readonly rlGameId: string;
  readonly attach: ItemId[];
  readonly raise: ItemId[];
  readonly conflicts: ConflictPlan[];
}

/** What matching did to one item; `resolveResult` turns it into a result. */
export interface ItemOutcome {
  readonly rlGameId: string;
  readonly created: boolean;
  readonly changed: boolean;
  readonly conflict: boolean;
}

/**
 * Steps (a)/(b): the item resolves to the owner of its highest-priority id
 * (steam, igdb, itad). Unowned ids attach to it; ids it owns may raise their
 * provenance (L5); an id another game owns is a conflict for that id alone
 * (AC 4/6). No owner at all → undefined (go to step (c)).
 */
export function planAgainstOwners(
  ids: readonly ItemId[],
  owners: readonly StoredId[],
): ItemPlan | undefined {
  const ownerOf = (i: ItemId): StoredId | undefined =>
    owners.find((o) => o.kind === i.kind && o.value === i.value);
  const primary = ids.map(ownerOf).find((o) => o !== undefined)?.rlGameId;
  if (primary === undefined) return undefined;
  const plan: ItemPlan = {
    rlGameId: primary,
    attach: [],
    raise: [],
    conflicts: [],
  };
  for (const id of ids) {
    const owner = ownerOf(id);
    if (owner === undefined) plan.attach.push(id);
    else if (owner.rlGameId !== primary) {
      plan.conflicts.push({
        id,
        existingRlGameId: primary,
        proposedRlGameId: owner.rlGameId,
      });
    } else if (shouldRaise(owner.provenance, id.provenance)) {
      plan.raise.push(id);
    }
  }
  return plan;
}

/** L8 precedence: conflict > attached > created > matched. */
export function resolveResult(
  clientRef: string,
  outcome: ItemOutcome,
): CrosswalkContributionResult {
  const result = outcome.conflict
    ? 'conflict'
    : outcome.changed
      ? 'attached'
      : outcome.created
        ? 'created'
        : 'matched';
  return { clientRef, result, rlGameId: outcome.rlGameId };
}
