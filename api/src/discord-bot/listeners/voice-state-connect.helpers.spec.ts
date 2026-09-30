/**
 * Voice connect-recovery helpers (TDB:836, TDB:175): every recovery step runs
 * in its own guard, and the binding-health report latches only on success.
 */
import * as Sentry from '@sentry/nestjs';
import { reportBindingHealthWarnings } from '../services/channel-bindings-heal.helpers';
import type { VoiceHandlerDeps } from './voice-state.handlers';
import { recoverFromVoiceChannels } from './voice-state-recovery.handlers';
import {
  connectRecoverySteps,
  onceOnSuccess,
  reportBindingHealth,
  runConnectRecoverySteps,
  startBindingCacheSweep,
  type BindingHealthDeps,
  type ConnectRecoveryStep,
} from './voice-state-connect.helpers';

jest.mock('@sentry/nestjs', () => ({
  captureMessage: jest.fn(),
  captureException: jest.fn(),
}));
jest.mock('../services/channel-bindings-heal.helpers', () => ({
  reportBindingHealthWarnings: jest.fn(),
}));
jest.mock('./voice-state-recovery.handlers', () => ({
  recoverFromVoiceChannels: jest.fn(),
}));

const STEP_NAMES = [
  'recoverActiveSessions',
  'bindingHealth',
  'presenceRecover',
  'recoverFromVoiceChannels',
  'startCacheSweep',
];

beforeEach(() => jest.clearAllMocks());

describe('runConnectRecoverySteps', () => {
  function buildSteps(failAt: number, mode: 'rejects' | 'throws') {
    const ran: string[] = [];
    const error = new Error(`boom-${failAt}`);
    const steps: ConnectRecoveryStep[] = STEP_NAMES.map((name, i) => ({
      name,
      run: () => {
        ran.push(name);
        if (i !== failAt) return Promise.resolve();
        if (mode === 'throws') throw error;
        return Promise.reject(error);
      },
    }));
    return { ran, error, steps };
  }

  it.each(
    [0, 1, 2, 3, 4].flatMap((i) => [
      [i, 'rejects' as const],
      [i, 'throws' as const],
    ]),
  )(
    'step %i %s: every step still runs once, in order',
    async (failAt, mode) => {
      const { ran, error, steps } = buildSteps(failAt, mode);
      const logger = { error: jest.fn() };

      await expect(
        runConnectRecoverySteps(steps, logger),
      ).resolves.toBeUndefined();

      expect(ran).toEqual(STEP_NAMES);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(error, {
        tags: { context: 'voice-connect-recovery', step: STEP_NAMES[failAt] },
      });
      expect(logger.error).toHaveBeenCalledWith(
        `[voice-connect] ${STEP_NAMES[failAt]} failed: Error: boom-${failAt}`,
      );
    },
  );
});

describe('connectRecoverySteps', () => {
  it('runs presence adoption before voice-channel recovery (ROK-1446 D7/AC8)', async () => {
    const calls: string[] = [];
    const track = (name: string) => () => {
      calls.push(name);
      return Promise.resolve();
    };
    jest
      .mocked(recoverFromVoiceChannels)
      .mockImplementation(track('recoverFromVoiceChannels'));
    const deps = {
      voiceAttendanceService: {
        recoverActiveSessions: track('recoverActiveSessions'),
      },
      channelPresence: { recover: track('presenceRecover') },
    } as unknown as VoiceHandlerDeps;
    const hooks = {
      deps,
      reportBindingHealth: track('bindingHealth'),
      resolveBinding: jest.fn(),
      handleJoin: jest.fn(),
      startCacheSweep: () => void track('startCacheSweep')(),
    };

    const steps = connectRecoverySteps(hooks);
    await runConnectRecoverySteps(steps, { error: jest.fn() });

    expect(steps.map((s) => s.name)).toEqual(STEP_NAMES);
    expect(calls).toEqual(STEP_NAMES);
    expect(recoverFromVoiceChannels).toHaveBeenCalledWith(
      deps,
      hooks.resolveBinding,
      hooks.handleJoin,
    );
  });
});

describe('onceOnSuccess', () => {
  it('runs again after a false result', async () => {
    const run = jest
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const once = onceOnSuccess(run);

    await once();
    await once();
    await once();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('runs again after a rejection', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(true);
    const once = onceOnSuccess(run);

    await expect(once()).rejects.toThrow('db down');
    await once();
    await once();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never runs again after a true result', async () => {
    const run = jest.fn().mockResolvedValue(true);
    const once = onceOnSuccess(run);

    await once();
    await once();
    await once();

    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('reportBindingHealth', () => {
  const BINDINGS = [{ channelId: 'vc-1', recurrenceGroupId: null }];

  function makeDeps(over: Partial<BindingHealthDeps> = {}) {
    return {
      db: {} as unknown as BindingHealthDeps['db'],
      clientService: { getGuildId: jest.fn().mockReturnValue('guild-1') },
      channelBindingsService: {
        getBindings: jest.fn().mockResolvedValue(BINDINGS),
      },
      logger: { warn: jest.fn() },
      ...over,
    };
  }

  it('returns true once the warnings report has run', async () => {
    const deps = makeDeps();

    await expect(reportBindingHealth(deps)).resolves.toBe(true);

    expect(deps.channelBindingsService.getBindings).toHaveBeenCalledWith(
      'guild-1',
    );
    expect(reportBindingHealthWarnings).toHaveBeenCalledWith(
      deps.db,
      BINDINGS,
      deps.logger,
    );
  });

  it('returns false without reading bindings when the guild id is missing', async () => {
    const deps = makeDeps({
      clientService: { getGuildId: jest.fn().mockReturnValue(null) },
    });

    await expect(reportBindingHealth(deps)).resolves.toBe(false);

    expect(deps.channelBindingsService.getBindings).not.toHaveBeenCalled();
    expect(reportBindingHealthWarnings).not.toHaveBeenCalled();
  });

  it('returns false without reading bindings when there is no db', async () => {
    const deps = makeDeps({ db: null });

    await expect(reportBindingHealth(deps)).resolves.toBe(false);

    expect(deps.channelBindingsService.getBindings).not.toHaveBeenCalled();
  });

  it('returns false and reports to Sentry when the bindings read rejects', async () => {
    const error = new Error('db down');
    const deps = makeDeps({
      channelBindingsService: {
        getBindings: jest.fn().mockRejectedValue(error),
      },
    });

    await expect(reportBindingHealth(deps)).resolves.toBe(false);

    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { context: 'binding-health' },
    });
    expect(deps.logger.warn).toHaveBeenCalledWith(
      '[binding-heal] health report failed: Error: db down',
    );
    expect(reportBindingHealthWarnings).not.toHaveBeenCalled();
  });
});

describe('startBindingCacheSweep', () => {
  afterEach(() => jest.useRealTimers());

  it('drops entries older than 10 minutes on each 10-minute tick', () => {
    jest.useFakeTimers();
    const now = Date.now();
    const cache = new Map([
      ['stale', { cachedAt: now - 1 }],
      ['fresh', { cachedAt: now + 5 * 60 * 1000 }],
    ]);

    const timer = startBindingCacheSweep(cache);
    jest.advanceTimersByTime(10 * 60 * 1000);
    clearInterval(timer);

    expect([...cache.keys()]).toEqual(['fresh']);
  });
});
