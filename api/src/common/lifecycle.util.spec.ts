import { Logger } from '@nestjs/common';
import { bestEffortInit } from './lifecycle.util';

describe('bestEffortInit', () => {
  let logger: Logger;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger('TestLabel');
    errorSpy = jest.spyOn(logger, 'error').mockImplementation();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('executes the callback successfully', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await bestEffortInit('TestInit', logger, fn);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('catches errors and logs them without re-throwing', async () => {
    const error = new Error('DB connection failed');
    const fn = jest.fn().mockRejectedValue(error);

    await expect(
      bestEffortInit('CacheWarm', logger, fn),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[bestEffortInit] CacheWarm failed — feature degraded but app continues',
      error.stack,
    );
  });

  it('handles non-Error throwables', async () => {
    const fn = jest.fn().mockRejectedValue('string-error');

    await expect(
      bestEffortInit('StringErr', logger, fn),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[bestEffortInit] StringErr failed — feature degraded but app continues',
      'string-error',
    );
  });
});
