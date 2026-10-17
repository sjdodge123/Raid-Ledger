/**
 * ROK-1454 D8 / ROK-1523 — the per-game work chain for LFG Discord surfaces.
 *
 * Two lifecycle events for one game can overlap: a third hand arriving while
 * the first post is still awaiting Discord, a withdrawal racing a conversion,
 * or (ROK-1523) the board's retire pass racing an ordinary `GROUP_CHANGED`.
 * An older render landing after a terminal one puts an OPEN-looking embed back
 * on a row that is already closed — and the reconcile never revisits it.
 * Chaining per game makes every handler see exactly the row the previous one
 * left behind.
 *
 * Extracted out of `LfmEmbedService` (where it lived as a private map) so the
 * board's own writer can join the SAME chain. It has to live on this side of
 * the wiring: `LfmEmbedModule` imports `LfgBoardModule`, so a board service
 * reaching into `LfmEmbedService` for the map would be a module cycle. One
 * instance, exported by `LfgBoardModule`, is what makes "same chain" true —
 * two instances would serialise two independent queues and prove nothing.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class LfgGameChainService {
  private readonly chains = new Map<number, Promise<void>>();

  /**
   * Queue `work` behind everything already queued for `gameId`.
   *
   * `prev.then(work, work)` on purpose: a rejected predecessor must not cancel
   * its successors, and the rejection is still the caller's to observe on the
   * promise that predecessor returned.
   *
   * @param gameId - The game whose chain to append to.
   * @param work - The work to run once the chain drains.
   * @returns A promise for this unit of work.
   */
  serialized(gameId: number, work: () => Promise<void>): Promise<void> {
    const prev = this.chains.get(gameId) ?? Promise.resolve();
    const next = prev.then(work, work).finally(() => {
      if (this.chains.get(gameId) === next) this.chains.delete(gameId);
    });
    this.chains.set(gameId, next);
    return next;
  }

  /**
   * Resolve once every queued handler for `gameId` has run.
   *
   * The emitter never awaits the LFM handlers (they must not throw into a
   * player's `POST /lfg`), so a caller that has just emitted has no other way
   * to observe the row the handler will leave behind — the ROK-1505 AC4 parity
   * walk reads the ledger through this. Not used by product code.
   *
   * @param gameId - Game whose chain to drain.
   */
  settle(gameId: number): Promise<void> {
    return this.chains.get(gameId) ?? Promise.resolve();
  }
}
