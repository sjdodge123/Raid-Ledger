/**
 * ROK-1676 (RH-6, Codex r3) — runs async critical sections one at a time,
 * in call order, within this process.
 *
 * RelayService passes every relay-token write through one instance: the
 * register's store-token-then-flag and the heartbeat 401's
 * compare-then-delete. A reconnect can then never store a new token
 * between a 401's comparison and its delete.
 */
export class SerialLock {
  private tail: Promise<unknown> = Promise.resolve();

  /** Run `section` after every section queued before it has settled. */
  run<T>(section: () => Promise<T>): Promise<T> {
    const result = this.tail.then(section);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
