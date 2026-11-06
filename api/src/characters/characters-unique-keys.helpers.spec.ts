/**
 * Unit tests for `reportCrossOwnerCharacterDeletes` input guarding (backlog
 * 3158): the game ids are stitched into `sql.raw`, so anything that is not a
 * safe integer must be refused before a statement is built or executed.
 */
import { reportCrossOwnerCharacterDeletes } from './characters-unique-keys.helpers';

function recordingTx(): { execute: jest.Mock<Promise<unknown[]>, []> } {
  return { execute: jest.fn((): Promise<unknown[]> => Promise.resolve([])) };
}

/** [label, loserGameId, winnerGameId] — each pair holds one bad id. */
const BAD_IDS: ReadonlyArray<[string, number, number]> = [
  ['NaN loser id', Number.NaN, 2],
  ['fractional loser id', 1.5, 2],
  ['NaN winner id', 1, Number.NaN],
  ['fractional winner id', 1, 2.5],
  ['unsafe winner id', 1, Number.MAX_SAFE_INTEGER + 1],
];

describe('reportCrossOwnerCharacterDeletes — game id guard', () => {
  it.each(BAD_IDS)(
    'rejects a %s without executing SQL',
    async (_label, loser, winner) => {
      const tx = recordingTx();
      await expect(
        reportCrossOwnerCharacterDeletes(tx, loser, winner),
      ).rejects.toThrow(/safe integer/);
      expect(tx.execute).not.toHaveBeenCalled();
    },
  );

  it('executes the report for safe integer ids', async () => {
    const tx = recordingTx();
    await expect(reportCrossOwnerCharacterDeletes(tx, 1, 2)).resolves.toBe(0);
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });
});
