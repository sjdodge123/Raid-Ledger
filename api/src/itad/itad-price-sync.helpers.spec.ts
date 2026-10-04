/**
 * Unit tests for processPricingChunks: the end-of-phase retry pass and the
 * consecutive-exhaustion breaker (TDB:1984).
 */
import {
  processPricingChunks,
  type PricingChunkOutcome,
} from './itad-price-sync.helpers';

type ChunkFn = jest.Mock<Promise<PricingChunkOutcome>, [number]>;

/** A processChunk mock that yields `outcomes` in call order, then `rest`. */
function outcomes(
  sequence: PricingChunkOutcome[],
  rest: PricingChunkOutcome = 'ok',
): ChunkFn {
  const fn: ChunkFn = jest.fn<Promise<PricingChunkOutcome>, [number]>(() =>
    Promise.resolve(rest),
  );
  for (const outcome of sequence) fn.mockResolvedValueOnce(outcome);
  return fn;
}

/** Chunks are just their index, so call order reads directly. */
function chunks(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

function calledChunks(fn: ChunkFn): number[] {
  return fn.mock.calls.map(([chunk]) => chunk);
}

describe('processPricingChunks — breaker trips', () => {
  it('trips after 3 consecutive exhausted chunks: skips the rest and the retry pass', async () => {
    const fn = outcomes(['exhausted', 'exhausted', 'exhausted']);

    const result = await processPricingChunks(chunks(6), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2]);
    expect(result).toEqual({
      succeeded: 0,
      failed: 6,
      retried: 0,
      tripped: true,
    });
  });

  it('a generic failure between exhausted chunks does not reset the streak', async () => {
    const fn = outcomes(['exhausted', 'failed', 'exhausted', 'exhausted']);

    const result = await processPricingChunks(chunks(5), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2, 3]);
    expect(result).toEqual({
      succeeded: 0,
      failed: 5,
      retried: 0,
      tripped: true,
    });
  });

  it('trips inside the retry pass too, counting the unretried chunks as failed', async () => {
    const fn = outcomes(
      ['failed', 'failed', 'failed', 'failed', 'exhausted', 'exhausted'],
      'exhausted',
    );

    const result = await processPricingChunks(chunks(4), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2, 3, 0, 1, 2]);
    expect(result).toEqual({
      succeeded: 0,
      failed: 4,
      retried: 4,
      tripped: true,
    });
  });
});

describe('processPricingChunks — retry pass without a trip', () => {
  it('never trips on generic failures, even 6 in a row: every chunk runs, then the retry pass', async () => {
    const fn = outcomes([], 'failed');

    const result = await processPricingChunks(chunks(6), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
    expect(result).toEqual({
      succeeded: 0,
      failed: 6,
      retried: 6,
      tripped: false,
    });
  });

  it('an ok chunk between exhausted chunks resets the streak', async () => {
    const fn = outcomes([
      'exhausted',
      'exhausted',
      'ok',
      'exhausted',
      'exhausted',
      'ok',
    ]);

    const result = await processPricingChunks(chunks(6), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 3, 4]);
    expect(result).toEqual({
      succeeded: 6,
      failed: 0,
      retried: 4,
      tripped: false,
    });
  });

  it('a chunk that recovers in the retry pass counts as succeeded', async () => {
    const fn = outcomes(['exhausted', 'ok', 'ok']);

    const result = await processPricingChunks(chunks(3), fn);

    expect(calledChunks(fn)).toEqual([0, 1, 2, 0]);
    expect(result).toEqual({
      succeeded: 3,
      failed: 0,
      retried: 1,
      tripped: false,
    });
  });
});
