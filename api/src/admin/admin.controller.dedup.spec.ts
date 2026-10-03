/**
 * Dedup-cleanup endpoint contract (ROK-1053 item 7).
 *
 * The endpoint is an operator maintenance tool with no UI consumer, so the
 * group count it now reports — and the audit line it logs — are the only
 * signals an operator gets about what a run actually did.
 */
import { Logger } from '@nestjs/common';
import type { EventEmitter2 } from '@nestjs/event-emitter';
import { AdminController } from './admin.controller';
import {
  dryRunNameDedup,
  findDuplicateGames,
  mergeAndDeleteDuplicates,
  mergeNameDuplicates,
} from '../igdb/igdb-dedup-cleanup.helpers';
import { CHANNEL_BINDING_EVENTS } from '../discord-bot/services/channel-binding-events';

jest.mock('../igdb/igdb-dedup-cleanup.helpers', () => ({
  findDuplicateGames: jest.fn(),
  mergeAndDeleteDuplicates: jest.fn(),
  mergeNameDuplicates: jest.fn(),
  dryRunNameDedup: jest.fn(),
}));

const findDuplicateGamesMock = findDuplicateGames as jest.MockedFunction<
  typeof findDuplicateGames
>;
const mergeAndDeleteDuplicatesMock =
  mergeAndDeleteDuplicates as jest.MockedFunction<
    typeof mergeAndDeleteDuplicates
  >;
const mergeNameDuplicatesMock = mergeNameDuplicates as jest.MockedFunction<
  typeof mergeNameDuplicates
>;
const dryRunNameDedupMock = dryRunNameDedup as jest.MockedFunction<
  typeof dryRunNameDedup
>;

/** Build the controller with only what the dedup endpoints touch. */
function buildController(emit: jest.Mock = jest.fn()): AdminController {
  return new AdminController(
    null as never,
    null as never,
    null as never,
    null as never,
    { emit } as unknown as EventEmitter2,
  );
}

describe('AdminController.dedupCleanup', () => {
  let controller: AdminController;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = buildController();
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

describe('AdminController dedup endpoints — binding-change announce', () => {
  let emit: jest.Mock;
  let controller: AdminController;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    emit = jest.fn();
    controller = buildController(emit);
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => logSpy.mockRestore());

  /** The listener the endpoint handed to a merge helper. */
  function passedListener(
    listener: ((channelIds: string[]) => void) | undefined,
  ): (channelIds: string[]) => void {
    if (typeof listener !== 'function') {
      throw new Error('merge helper was called without a listener');
    }
    return listener;
  }

  const expectedEmits = [
    [CHANNEL_BINDING_EVENTS.CHANGED, { channelId: 'a' }],
    [CHANNEL_BINDING_EVENTS.CHANGED, { channelId: 'b' }],
  ];

  it('dedupCleanup emits one CHANGED per distinct channel a merge rewrote', async () => {
    findDuplicateGamesMock.mockResolvedValue([{ winnerId: 1, loserIds: [2] }]);
    mergeAndDeleteDuplicatesMock.mockResolvedValue({ merged: 1, errors: [] });

    const result = await controller.dedupCleanup();
    expect(emit).not.toHaveBeenCalled();
    const call = mergeAndDeleteDuplicatesMock.mock.calls.at(-1);
    passedListener(call?.[2])(['a', 'a', 'b']);

    expect(result).toEqual({ groups: 1, merged: 1, errors: [] });
    expect(emit.mock.calls).toEqual(expectedEmits);
  });

  it('dedupCleanupByName (commit) emits one CHANGED per distinct channel', async () => {
    const commit = { merged: 1, errors: [], report: [], skippedGroups: [] };
    mergeNameDuplicatesMock.mockResolvedValue(commit);

    const result = await controller.dedupCleanupByName('false');
    const call = mergeNameDuplicatesMock.mock.calls.at(-1);
    passedListener(call?.[1])(['a', 'a', 'b']);

    expect(result).toBe(commit);
    expect(emit.mock.calls).toEqual(expectedEmits);
  });

  it('dedupCleanupByName dry-run never merges and never emits', async () => {
    const dry = {
      totalGroups: 0,
      totalLosers: 0,
      groups: [],
      skippedGroups: [],
    };
    dryRunNameDedupMock.mockResolvedValue(dry);

    const result = await controller.dedupCleanupByName();

    expect(result).toBe(dry);
    expect(mergeNameDuplicatesMock).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
