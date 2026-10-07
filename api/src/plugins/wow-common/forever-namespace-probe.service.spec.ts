import { BadRequestException, Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type { SettingsService } from '../../settings/settings.service';
import type { BlizzardAuthService } from './blizzard-auth.service';
import { ForeverNamespaceProbeService } from './forever-namespace-probe.service';
import { runProbe, type ProbeRun } from './forever-namespace-probe.helpers';
import {
  WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY,
  WOW_FOREVER_PROBE_FOUND_KEY,
  WOW_FOREVER_PROBE_LAST_RESULT_KEY,
  WOW_FOREVER_PROBE_SETTING_KEYS,
} from './forever.settings';
import { WOW_COMMON_MANIFEST } from './manifest';

jest.mock('@sentry/nestjs', () => ({ captureMessage: jest.fn() }));
jest.mock('./forever-namespace-probe.helpers', () => ({
  ...jest.requireActual<object>('./forever-namespace-probe.helpers'),
  runProbe: jest.fn(),
}));

const runProbeMock = runProbe as jest.MockedFunction<typeof runProbe>;
const captureMessage = Sentry.captureMessage as jest.Mock;

/** A probe run with a Skyborne match under `prefix` (or none). */
function probeRun(prefix: string | null): ProbeRun {
  const cells: ProbeRun['cells'] = [
    { prefix: 'classic', region: 'us', endpoint: 'playable-race', status: 200 },
  ];
  if (!prefix) return { cells, matches: [], shapes: {} };
  cells.push(
    { prefix, region: 'us', endpoint: 'playable-race', status: 200 },
    { prefix, region: 'us', endpoint: 'profile', status: 404 },
  );
  return {
    cells,
    matches: [{ prefix, region: 'us', raceName: 'Skyborne' }],
    shapes: {
      [`${prefix}:us:realm`]: {
        topLevelKeys: ['realms'],
        entryCount: 2,
        sample: [],
      },
    },
  };
}

function setup(configured = true) {
  const store = new Map<string, string>();
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    delete: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
    isBlizzardConfigured: jest.fn(() => Promise.resolve(configured)),
  };
  const auth = { getAccessToken: jest.fn(() => Promise.resolve('tok')) };
  const service = new ForeverNamespaceProbeService(
    settings as unknown as SettingsService,
    auth as unknown as BlizzardAuthService,
  );
  return { service, settings, auth, store };
}

beforeEach(() => {
  jest.clearAllMocks();
  runProbeMock.mockResolvedValue(probeRun(null));
});

describe('ForeverNamespaceProbeService.run — alerting', () => {
  it('alerts once on the first Skyborne match and persists found + result', async () => {
    const { service, store } = setup();
    runProbeMock.mockResolvedValue(probeRun('classicforever'));
    const result = await service.run();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(
      'Forever namespace found: classicforever',
      expect.objectContaining({
        level: 'info',
        tags: { context: 'wow-forever-probe' },
        extra: {
          regions: ['us'],
          endpoints: ['us:playable-race'],
          profileStatus: [404],
        },
      }),
    );
    expect(result.status).toBe('ok');
    expect(result.found).toEqual({
      prefix: 'classicforever',
      at: result.ranAt,
    });
    expect(JSON.parse(store.get(WOW_FOREVER_PROBE_FOUND_KEY) ?? '')).toEqual(
      result.found,
    );
    expect(
      JSON.parse(store.get(WOW_FOREVER_PROBE_LAST_RESULT_KEY) ?? ''),
    ).toEqual(result);
  });

  it('does not alert again for the same prefix and keeps the first time', async () => {
    const { service } = setup();
    runProbeMock.mockResolvedValue(probeRun('classicforever'));
    const first = await service.run();
    const second = await service.run();
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(second.found).toEqual(first.found);
  });

  it('alerts again when a different prefix matches', async () => {
    const { service } = setup();
    runProbeMock.mockResolvedValueOnce(probeRun('classicforever'));
    runProbeMock.mockResolvedValueOnce(probeRun('forever'));
    await service.run();
    const second = await service.run();
    expect(captureMessage).toHaveBeenCalledTimes(2);
    expect(second.found?.prefix).toBe('forever');
  });
});

describe('ForeverNamespaceProbeService.run — no alert', () => {
  it('does not alert for a classic control 200 without Skyborne', async () => {
    const { service, store } = setup();
    const result = await service.run();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(result.found).toBeNull();
    expect(store.has(WOW_FOREVER_PROBE_FOUND_KEY)).toBe(false);
  });

  it('logs the shape summaries', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { service } = setup();
    runProbeMock.mockResolvedValue(probeRun('classicforever'));
    await service.run();
    expect(log.mock.calls.flat().join('\n')).toContain(
      'classicforever:us:realm',
    );
    log.mockRestore();
  });
});

describe('ForeverNamespaceProbeService.run — gating', () => {
  it('skips without Blizzard creds: no token, no probe, no alert', async () => {
    const { service, auth, store } = setup(false);
    const result = await service.run();
    expect(result.status).toBe('skipped');
    expect(result.cells).toEqual([]);
    expect(auth.getAccessToken).not.toHaveBeenCalled();
    expect(runProbeMock).not.toHaveBeenCalled();
    expect(captureMessage).not.toHaveBeenCalled();
    expect(store.has(WOW_FOREVER_PROBE_LAST_RESULT_KEY)).toBe(true);
  });

  it('returns an error result (no throw) when the token fetch fails', async () => {
    const { service, auth } = setup();
    auth.getAccessToken.mockRejectedValue(new Error('bad creds'));
    const result = await service.run();
    expect(result.status).toBe('error');
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('joins a run in progress instead of starting another', async () => {
    const { service } = setup();
    let release: (r: ProbeRun) => void = () => undefined;
    runProbeMock.mockReturnValueOnce(new Promise((r) => (release = r)));
    const a = service.run();
    const b = service.run();
    await new Promise((r) => setImmediate(r));
    release(probeRun(null));
    expect(await a).toBe(await b);
    expect(runProbeMock).toHaveBeenCalledTimes(1);
    await service.run();
    expect(runProbeMock).toHaveBeenCalledTimes(2);
  });

  it('runIfInLaunchWindow no-ops outside the window and runs inside', async () => {
    const { service } = setup();
    expect(
      await service.runIfInLaunchWindow(new Date('2026-11-19T00:00:00Z')),
    ).toBeNull();
    expect(runProbeMock).not.toHaveBeenCalled();
    const inside = await service.runIfInLaunchWindow(
      new Date('2026-11-04T00:00:00Z'),
    );
    expect(inside?.status).toBe('ok');
    expect(runProbeMock).toHaveBeenCalledTimes(1);
  });
});

describe('ForeverNamespaceProbeService config + state', () => {
  it('returns an empty state before any run or config', async () => {
    const { service } = setup();
    expect(await service.getState()).toEqual({
      result: null,
      extraCandidates: [],
      characterPath: null,
    });
  });
});

describe('ForeverNamespaceProbeService config', () => {
  it('stores config and feeds it into the next run', async () => {
    const { service } = setup();
    const state = await service.updateConfig({
      extraCandidates: ['classicann'],
      characterPath: 'dreamscythe/thrall',
    });
    expect(state).toMatchObject({
      extraCandidates: ['classicann'],
      characterPath: 'dreamscythe/thrall',
    });
    await service.run();
    expect(runProbeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        candidates: expect.arrayContaining(['classicann', 'classic']),
        regions: ['us', 'eu', 'kr', 'tw'],
        characterPath: 'dreamscythe/thrall',
        token: 'tok',
      }),
    );
  });

  it('deletes cleared config keys', async () => {
    const { service, store } = setup();
    await service.updateConfig({
      extraCandidates: ['fe'],
      characterPath: 'a/b',
    });
    await service.updateConfig({ extraCandidates: [], characterPath: null });
    expect(store.size).toBe(0);
  });

  it('rejects an invalid body', async () => {
    const { service } = setup();
    await expect(
      service.updateConfig({
        extraCandidates: ['Bad Prefix'],
        characterPath: null,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['dreamscythe/..', 'dreamscythe/.'])(
    'rejects a dot-only character name (%s) that would change the Blizzard path',
    async (characterPath) => {
      const { service } = setup();
      await expect(
        service.updateConfig({ extraCandidates: [], characterPath }),
      ).rejects.toBeInstanceOf(BadRequestException);
    },
  );
});

describe('ForeverNamespaceProbeService stored state', () => {
  it('treats corrupt stored JSON as absent', async () => {
    const { service, store } = setup();
    store.set(WOW_FOREVER_PROBE_LAST_RESULT_KEY, '{nope');
    store.set(WOW_FOREVER_PROBE_EXTRA_CANDIDATES_KEY, '"x"');
    const state = await service.getState();
    expect(state.result).toBeNull();
    expect(state.extraCandidates).toEqual([]);
  });

  it('only ever writes its own plugin-owned keys (never ROK-1717 keys)', async () => {
    const { service, settings } = setup();
    runProbeMock.mockResolvedValue(probeRun('classicforever'));
    await service.run();
    await service.updateConfig({
      extraCandidates: ['fe'],
      characterPath: null,
    });
    const written = [
      ...settings.set.mock.calls,
      ...settings.delete.mock.calls,
    ].map((c) => c[0]);
    expect(written.length).toBeGreaterThan(0);
    for (const key of written)
      expect(WOW_FOREVER_PROBE_SETTING_KEYS).toContain(key);
    expect(WOW_COMMON_MANIFEST.settingKeys).toEqual(
      expect.arrayContaining(WOW_FOREVER_PROBE_SETTING_KEYS),
    );
  });
});
