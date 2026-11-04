/**
 * Tech-debt 2026-10-27 (ROK-1956 R2) — one user's in-flight blob uploads
 * are bounded by THAT user's quota, not only by the global cap. Each upload
 * holds its worst-case bytes (the reservation size) here from the quota
 * check until it finishes, and the quota check counts the user's live holds:
 * `stored + live holds + declared <= quota`. Without it ~40 chunked uploads
 * a minute could hold ~200 MiB against a 64 MiB quota for the 300 s request
 * timeout, and a few dozen accounts could fill the global cap.
 *
 * In-process on purpose: the API runs as one process (allinone image), the
 * check and the increment run in the same synchronous step (no await
 * between them), and a crash drops every hold with the process — nothing to
 * expire, no schema change. The global cap stays the cross-process,
 * database-locked bound in `CompanionBlobReservations`.
 */
export class CompanionBlobUserHolds {
  private readonly held = new Map<number, number>();

  /** Bytes `userId`'s live uploads currently hold. */
  bytes(userId: number): number {
    return this.held.get(userId) ?? 0;
  }

  /**
   * Hold `bytes` for `userId` when `need` (stored + declared) plus the live
   * holds fits `quota`. Returns an idempotent release, or null when full.
   */
  tryHold(
    userId: number,
    need: number,
    bytes: number,
    quota: number,
  ): (() => void) | null {
    if (need + this.bytes(userId) > quota) return null;
    this.held.set(userId, this.bytes(userId) + bytes);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = this.bytes(userId) - bytes;
      if (left > 0) this.held.set(userId, left);
      else this.held.delete(userId);
    };
  }
}
