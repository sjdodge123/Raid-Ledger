/**
 * ROK-2124: the post-import auto-link nudge is fire-and-forget — it starts
 * one attempt, never blocks the caller, and a rejection only logs a warning.
 * The "not on a dry run" rule is pinned in the two service specs.
 */
import { nudgeAutoLink } from './addon-import.autolink-nudge';

const flush = (): Promise<void> => new Promise((r) => setImmediate(r));

function setup(attempt: jest.Mock) {
  const logger = { warn: jest.fn() };
  return { autoLink: { attempt }, logger };
}

describe('nudgeAutoLink (ROK-2124)', () => {
  it('starts one attempt for the character', async () => {
    const { autoLink, logger } = setup(jest.fn().mockResolvedValue('linked'));
    nudgeAutoLink(autoLink, 'char-1', logger);
    await flush();
    expect(autoLink.attempt).toHaveBeenCalledTimes(1);
    expect(autoLink.attempt).toHaveBeenCalledWith('char-1');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('returns before the attempt settles (never awaited)', () => {
    const { autoLink, logger } = setup(
      jest.fn().mockReturnValue(new Promise(() => undefined)),
    );
    expect(nudgeAutoLink(autoLink, 'char-1', logger)).toBeUndefined();
    expect(autoLink.attempt).toHaveBeenCalledWith('char-1');
  });

  it('a rejected attempt only logs a warning naming the character', async () => {
    const { autoLink, logger } = setup(
      jest.fn().mockRejectedValue(new Error('Blizzard down')),
    );
    expect(() => nudgeAutoLink(autoLink, 'char-1', logger)).not.toThrow();
    await flush();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'Forever auto-link nudge for char-1 failed: Blizzard down',
    );
  });

  it('a non-Error rejection is stringified', async () => {
    const { autoLink, logger } = setup(jest.fn().mockRejectedValue('boom'));
    nudgeAutoLink(autoLink, 'char-1', logger);
    await flush();
    expect(logger.warn).toHaveBeenCalledWith(
      'Forever auto-link nudge for char-1 failed: boom',
    );
  });

  it('a null character id does nothing', async () => {
    const { autoLink, logger } = setup(jest.fn().mockResolvedValue('linked'));
    nudgeAutoLink(autoLink, null, logger);
    await flush();
    expect(autoLink.attempt).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
