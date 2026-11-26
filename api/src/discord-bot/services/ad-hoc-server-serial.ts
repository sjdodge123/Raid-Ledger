/**
 * Per-game serialisation for the Quick Play server-presence sink: one spawn
 * decision at a time per game (ROK-1800). Extracted from
 * `AdHocServerPresenceService` (ROK-2355) so the Pelican off-switch can wait
 * for in-flight sink calls to settle.
 */
export class PerGameSerial {
  private readonly chains = new Map<number, Promise<unknown>>();

  /** Run `fn` after every earlier call for the same game has settled. */
  run<T = void>(gameId: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(gameId) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.chains.set(
      gameId,
      next.catch(() => undefined),
    );
    return next;
  }

  /**
   * Queue `fn(gameId)` behind every game seen so far, each in its own turn,
   * so it runs after that game's in-flight calls and before later ones.
   */
  async runAll(fn: (gameId: number) => void): Promise<void> {
    const games = [...this.chains.keys()];
    await Promise.all(
      games.map((g) => this.run(g, () => Promise.resolve(fn(g)))),
    );
  }

  /** Resolves once every call queued so far, on every game, has settled. */
  async settled(): Promise<void> {
    await Promise.all([...this.chains.values()]);
  }
}
