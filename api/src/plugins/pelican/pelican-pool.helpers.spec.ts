import { runPool } from './pelican-pool.helpers';

/** A deferred the test resolves by hand, so in-flight count is observable. */
function gate() {
  let open: () => void = () => {};
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open: () => open() };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('runPool', () => {
  it('never has more than `limit` calls in flight and runs each item once', async () => {
    const gates = Array.from({ length: 10 }, () => gate());
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    const pool = runPool([...gates.keys()], 4, async (i) => {
      seen.push(i);
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gates[i]?.done;
      inFlight--;
    });
    await tick();
    expect(inFlight).toBe(4);
    for (const g of gates) {
      g.open();
      await tick();
    }
    await pool;
    expect(peak).toBe(4);
    expect([...seen].sort((a, b) => a - b)).toEqual([...gates.keys()]);
  });

  it('resolves immediately for an empty list', async () => {
    const fn = jest.fn(() => Promise.resolve());
    await runPool([], 4, fn);
    expect(fn).not.toHaveBeenCalled();
  });
});
