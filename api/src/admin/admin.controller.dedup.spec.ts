/**
 * Dedup-cleanup endpoint contract (ROK-1053 item 7).
 *
 * The endpoint is an operator maintenance tool with no UI consumer, so the
 * group count it now reports — and the audit line it logs — are the only
 * signals an operator gets about what a run actually did.
 */
import { Logger } from '@nestjs/common';
import { AdminController } from './admin.controller';
import {
  findDuplicateGames,
  mergeAndDeleteDuplicates,
} from '../igdb/igdb-dedup-cleanup.helpers';

jest.mock('../igdb/igdb-dedup-cleanup.helpers', () => ({
  findDuplicateGames: jest.fn(),
  mergeAndDeleteDuplicates: jest.fn(),
}));

const findDuplicateGamesMock = findDuplicateGames as jest.MockedFunction<
  typeof findDuplicateGames
>;
const mergeAndDeleteDuplicatesMock =
  mergeAndDeleteDuplicates as jest.MockedFunction<
    typeof mergeAndDeleteDuplicates
  >;

describe('AdminController.dedupCleanup', () => {
  let controller: AdminController;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdminController(
      null as never,
      null as never,
      null as never,
      null as never,
    );
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => logSpy.mockRestore());

  it('reports how many duplicate groups the run considered', async () => {
    findDuplicateGamesMock.mockResolvedValue([
      { winnerId: 1, loserIds: [2] },
      { winnerId: 3, loserIds: [4, 5] },
    ]);
    mergeAndDeleteDuplicatesMock.mockResolvedValue({ merged: 3, errors: [] });

    const result = await controller.dedupCleanup();

    expect(result).toEqual({ groups: 2, merged: 3, errors: [] });
  });

  it('still reports a group count when nothing merged', async () => {
    findDuplicateGamesMock.mockResolvedValue([]);
    mergeAndDeleteDuplicatesMock.mockResolvedValue({ merged: 0, errors: [] });

    const result = await controller.dedupCleanup();

    // 0 groups is a meaningfully different outcome from "merged nothing
    // because every merge failed" — the count is what separates them.
    expect(result.groups).toBe(0);
  });

  it('surfaces merge errors alongside the counts', async () => {
    findDuplicateGamesMock.mockResolvedValue([{ winnerId: 1, loserIds: [2] }]);
    mergeAndDeleteDuplicatesMock.mockResolvedValue({
      merged: 0,
      errors: ['game 2: FK reassign failed'],
    });

    const result = await controller.dedupCleanup();

    expect(result).toEqual({
      groups: 1,
      merged: 0,
      errors: ['game 2: FK reassign failed'],
    });
  });

  it('writes an audit line for the run', async () => {
    findDuplicateGamesMock.mockResolvedValue([{ winnerId: 1, loserIds: [2] }]);
    mergeAndDeleteDuplicatesMock.mockResolvedValue({ merged: 1, errors: [] });

    await controller.dedupCleanup();

    const lines = logSpy.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes('1 duplicate group(s) found'))).toBe(
      true,
    );
    expect(lines.some((l) => l.includes('merged 1 row(s)'))).toBe(true);
  });
});
