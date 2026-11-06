import type { BlizzardService } from './blizzard.service';
import type { ForeverRulesetFetchOutcome } from './blizzard-forever-ruleset.fetch';
import type { SettingsService } from '../../settings/settings.service';
import { WOW_FOREVER_ARMORY_IMPORT_KEY } from './forever.settings';
import { resetUnmappedRulesetWarnings } from './forever-ruleset-inference.helpers';
import {
  ForeverRulesetLookupService,
  RULESET_ERROR_TTL_MS,
  RULESET_HIT_TTL_MS,
  RULESET_LOOKUP_BUDGET_MS,
  RULESET_MISS_TTL_MS,
} from './forever-ruleset-lookup.service';

type FetchFn = (
  name: string,
  region: string,
  signal: AbortSignal,
) => Promise<ForeverRulesetFetchOutcome>;

/** ROK-2100 §6 — the lookup's gates, budget and cache over stubbed seams. */
function setup(opts: { configured?: boolean; switchValue?: string } = {}) {
  const state = { switchValue: opts.switchValue, configured: opts.configured };
  const settings = {
    getBlizzardConfig: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          state.configured === false
            ? null
            : { clientId: 'x', clientSecret: 'y' },
        ),
      ),
    get: jest.fn((key: string) =>
      Promise.resolve(
        key === WOW_FOREVER_ARMORY_IMPORT_KEY
          ? (state.switchValue ?? null)
          : null,
      ),
    ),
  };
  const fetchRaw = jest.fn<ReturnType<FetchFn>, Parameters<FetchFn>>();
  const blizzard = { fetchForeverRulesetRaw: fetchRaw };
  const service = new ForeverRulesetLookupService(
    settings as unknown as SettingsService,
    blizzard as unknown as BlizzardService,
  );
  return { service, fetchRaw, state };
}

const found = (ruleset: unknown): ForeverRulesetFetchOutcome => ({
  kind: 'found',
  ruleset,
});

beforeEach(() => {
  jest.useFakeTimers();
  resetUnmappedRulesetWarnings();
});
afterEach(() => jest.useRealTimers());

describe('ForeverRulesetLookupService gates (ROK-2100)', () => {
  it('Blizzard not configured → null without a fetch', async () => {
    const { service, fetchRaw } = setup({ configured: false });
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    expect(fetchRaw).not.toHaveBeenCalled();
  });

  it('a cached hit is ignored once the switch is turned off', async () => {
    const { service, fetchRaw, state } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'PVP' }));
    expect(await service.lookup('Ana Forever', 'us')).toBe('pvp');
    state.switchValue = 'false';
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    expect(fetchRaw).toHaveBeenCalledTimes(1);
  });

  it('a cached hit is ignored once Blizzard is unconfigured', async () => {
    const { service, fetchRaw, state } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'PVP' }));
    expect(await service.lookup('Ana Forever', 'us')).toBe('pvp');
    state.configured = false;
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
  });

  it("Forever Armory switch 'false' → null without a fetch", async () => {
    const { service, fetchRaw } = setup({ switchValue: 'false' });
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    expect(fetchRaw).not.toHaveBeenCalled();
  });
});

describe('ForeverRulesetLookupService results and cache (ROK-2100)', () => {
  it('a mapped ruleset resolves and is cached for 24h per lower(name)+region', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'RP_PVP' }));
    expect(await service.lookup('Ana Forever', 'us')).toBe('rppvp');
    expect(await service.lookup('ana forever', 'us')).toBe('rppvp');
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    expect(fetchRaw.mock.calls[0]?.slice(0, 2)).toEqual(['Ana Forever', 'us']);
    jest.advanceTimersByTime(RULESET_HIT_TTL_MS + 1);
    await service.lookup('Ana Forever', 'us');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('another region is a different cache key', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'PVP' }));
    await service.lookup('Ana Forever', 'us');
    await service.lookup('Ana Forever', 'eu');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('a 404/403 (absent) → null, re-fetched only after 1h', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue({ kind: 'absent' });
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    jest.advanceTimersByTime(RULESET_MISS_TTL_MS - 1);
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2);
    await service.lookup('Ana Forever', 'us');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('a transient error → null, held only for the short error TTL', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue({ kind: 'error' });
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
    jest.advanceTimersByTime(RULESET_ERROR_TTL_MS + 1);
    await service.lookup('Ana Forever', 'us');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('a rejected fetch (token failure) → null, never throws', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockRejectedValue(new Error('token down'));
    await expect(service.lookup('Ana Forever', 'us')).resolves.toBeNull();
  });

  it('an unknown ruleset shape → null', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'SEASONAL' }));
    expect(await service.lookup('Ana Forever', 'us')).toBeNull();
  });
});

describe('ForeverRulesetLookupService budget and invalidation (ROK-2100)', () => {
  it('a fetch that never settles → null once the budget elapses, and the signal aborts', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockReturnValue(new Promise<ForeverRulesetFetchOutcome>(() => {}));
    const pending = service.lookup('Ana Forever', 'us');
    await jest.advanceTimersByTimeAsync(RULESET_LOOKUP_BUDGET_MS);
    expect(await pending).toBeNull();
    expect(fetchRaw.mock.calls[0]?.[2].aborted).toBe(true);
  });

  it('a timeout is remembered 60s: the next call is immediate null, then it retries after 61s', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockReturnValue(new Promise<ForeverRulesetFetchOutcome>(() => {}));
    const first = service.lookup('Ana Forever', 'us');
    await jest.advanceTimersByTimeAsync(RULESET_LOOKUP_BUDGET_MS);
    expect(await first).toBeNull();
    expect(await service.lookup('ana forever', 'us')).toBeNull();
    expect(fetchRaw).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(61_000);
    fetchRaw.mockResolvedValue(found({ type: 'PVP' }));
    expect(await service.lookup('Ana Forever', 'us')).toBe('pvp');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });

  it('BLIZZARD_UPDATED clears the cache', async () => {
    const { service, fetchRaw } = setup();
    fetchRaw.mockResolvedValue(found({ type: 'PVP' }));
    await service.lookup('Ana Forever', 'us');
    service.clearCache();
    await service.lookup('Ana Forever', 'us');
    expect(fetchRaw).toHaveBeenCalledTimes(2);
  });
});
