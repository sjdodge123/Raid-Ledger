/** ROK-1700 — the pre-Nest boot guard: logs, reports to Sentry, exits 1. */
import * as Sentry from '@sentry/nestjs';
import { enforceFlavourBootGuards, type FlavourBootDeps } from './flavour-boot';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
  flush: jest.fn().mockResolvedValue(true),
}));

class ExitCalled extends Error {}

function makeDeps() {
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  const exit = jest.fn((code: number): never => {
    throw new ExitCalled(`exit ${code}`);
  });
  const deps: FlavourBootDeps = { logger, exit };
  return { deps, logger, exit };
}

describe('ROK-1700 enforceFlavourBootGuards', () => {
  beforeEach(() => jest.clearAllMocks());

  it('cloud + DEMO_MODE → logs the reason, reports + flushes Sentry, exits 1', async () => {
    const { deps, logger, exit } = makeDeps();
    await expect(
      enforceFlavourBootGuards(
        { RL_FLAVOUR: 'cloud', DEMO_MODE: 'true' },
        deps,
      ),
    ).rejects.toThrow('exit 1');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'RL_FLAVOUR=cloud cannot run with DEMO_MODE=true',
      ),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.flush).toHaveBeenCalledWith(2000);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('unknown flavour → exits 1 naming the variable', async () => {
    const { deps, logger, exit } = makeDeps();
    await expect(
      enforceFlavourBootGuards({ RL_FLAVOUR: 'bogus' }, deps),
    ).rejects.toThrow('exit 1');
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('RL_FLAVOUR="bogus"'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('nas + DEMO_MODE boots: logs the flavour, no warning, no exit', async () => {
    const { deps, logger, exit } = makeDeps();
    await enforceFlavourBootGuards({ DEMO_MODE: 'true' }, deps);
    expect(logger.log).toHaveBeenCalledWith('Runtime flavour: nas');
    expect(logger.warn).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it('cloud with FLEET_* set → exactly ONE warning, no exit', async () => {
    const { deps, logger, exit } = makeDeps();
    await enforceFlavourBootGuards(
      {
        RL_FLAVOUR: 'cloud',
        FLEET_FIRST_DISCORD_LOGIN_ADMIN: 'true',
        FLEET_ADMIN_DISCORD_ID: '123456789012345678',
      },
      deps,
    );
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'FLEET_FIRST_DISCORD_LOGIN_ADMIN, FLEET_ADMIN_DISCORD_ID',
      ),
    );
    expect(exit).not.toHaveBeenCalled();
  });
});
