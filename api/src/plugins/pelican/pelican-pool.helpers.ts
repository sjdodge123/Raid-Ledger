/**
 * Run `fn` over `items` with at most `limit` calls in flight (ROK-1772 D6).
 * The workers share one iterator, so each item runs exactly once. No new
 * dependency. `fn` should not throw; a throw rejects the pool.
 */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const queue = items.values();
  const worker = async (): Promise<void> => {
    for (const item of queue) await fn(item);
  };
  const width = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: width }, () => worker()));
}
