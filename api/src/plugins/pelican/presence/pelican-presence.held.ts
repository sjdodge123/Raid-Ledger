/**
 * ROK-1802 Codex r4 — players the sink still HOLDS for a server when a new
 * session opens, whose join line fell outside the replay. The tracker never
 * saw them, yet a heartbeat count can enrol them (`playerCount` → covered →
 * spawn or attach), so the session must still report their departures.
 *
 * They are deliberately kept OUT of the tracker: a tracked player's re-join
 * emits nothing, and that join line is what re-confirms a hold without a
 * heartbeat. A `joined` change for one hands them to the tracker; until then
 * a disconnect line, or a heartbeat with no room left for them after the
 * tracked players, reports them gone — oldest hold first, as the sink drops
 * uncovered holds.
 */
export class UntrackedHeldPlayers {
  /** Hold order, oldest first. */
  private ids: string[] = [];

  /** A fresh session: the sink's holds, minus players it already enrolled. */
  reset(held: string[], enrolled: string[]): void {
    const skip = new Set(enrolled);
    this.ids = held.filter((id) => !skip.has(id));
  }

  /** The tracker now owns this player (a `joined` change), or they are gone. */
  forget(steamId: string): boolean {
    const before = this.ids.length;
    this.ids = this.ids.filter((id) => id !== steamId);
    return this.ids.length < before;
  }

  /**
   * A heartbeat counted `count` players, `tracked` of them the tracker's
   * (handshakes it could promote come first). Returns the held players with
   * no room left — they have gone — oldest first.
   */
  fit(count: number, tracked: number): string[] {
    const room = Math.max(0, count - tracked);
    const gone = this.ids.slice(0, Math.max(0, this.ids.length - room));
    this.ids = this.ids.slice(gone.length);
    return gone;
  }

  clear(): void {
    this.ids = [];
  }
}
