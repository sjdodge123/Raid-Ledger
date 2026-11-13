import {
  BUSY_BLOCK_INSERT_CHUNK,
  chunkRows,
  insertBusyBlocks,
  type BusyBlockInserter,
} from './calendar-busy-insert.helpers';
import type { NormalizedBusyBlock } from './calendar-read-normalize.helpers';

function block(i: number): NormalizedBusyBlock {
  const startsAt = new Date(Date.UTC(2026, 10, 13, 0, i));
  return {
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60_000),
    allDay: false,
    firstDate: null,
    lastDate: null,
  };
}

/** An inserter that records each `values(...)` batch it receives. */
function recordingInserter(): { tx: BusyBlockInserter; batches: unknown[][] } {
  const batches: unknown[][] = [];
  const tx: BusyBlockInserter = {
    insert: () => ({
      values: (rows) => {
        batches.push(rows);
        return Promise.resolve(undefined);
      },
    }),
  };
  return { tx, batches };
}

describe('chunkRows', () => {
  it('splits rows into consecutive chunks of at most `size`', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('returns no chunks for no rows', () => {
    expect(chunkRows([], 1000)).toEqual([]);
  });

  it('rejects a non-positive chunk size', () => {
    expect(() => chunkRows([1], 0)).toThrow(RangeError);
  });
});

describe('insertBusyBlocks', () => {
  const owner = { connectionId: 3, userId: 7 };

  it('inserts 2,500 blocks in chunks of at most 1,000 rows, every row once with its owner', async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => block(i));
    const { tx, batches } = recordingInserter();

    await insertBusyBlocks(tx, rows, owner);

    expect(BUSY_BLOCK_INSERT_CHUNK).toBe(1_000);
    expect(batches.map((b) => b.length)).toEqual([1_000, 1_000, 500]);
    expect(batches.flat()).toEqual(rows.map((r) => ({ ...r, ...owner })));
  });

  it('issues no insert for no rows', async () => {
    const { tx, batches } = recordingInserter();

    await insertBusyBlocks(tx, [], owner);

    expect(batches).toEqual([]);
  });
});
