/**
 * CooptimusService transport spec (ROK-1397) — the permission gate itself,
 * previously only exercised via mocks in the sync integration spec
 * (review finding): unconfigured ⇒ null + warn-once, configured ⇒ real
 * fetch with the UA header, 403 mapped to the honest allowlisting message,
 * and the throttle actually serializing concurrent callers.
 */
import { CooptimusService } from './cooptimus.service';
import type { SettingsService } from '../settings/settings.service';
import { COOPTIMUS_RATE_LIMIT_MS } from './cooptimus.constants';

const PALWORLD_XML =
  '<games><game><id>9814</id><title>Palworld</title><system>PC</system><online>32</online></game></games>';

function makeService(ua: string | null) {
  const settings = {
    getCooptimusUserAgent: jest.fn().mockResolvedValue(ua),
    isCooptimusConfigured: jest.fn().mockResolvedValue(ua != null),
  } as unknown as SettingsService;
  return new CooptimusService(settings);
}

function mockFetch(status: number, body: string) {
  return jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(body),
  } as Response);
}

describe('CooptimusService (ROK-1397)', () => {
  afterEach(() => jest.restoreAllMocks());

  it('unconfigured: lookups return null, fetch never fires, warns once', async () => {
    const svc = makeService(null);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const warnSpy = jest.spyOn(svc['logger'], 'warn').mockImplementation();

    expect(await svc.searchByName('Palworld')).toBeNull();
    expect(await svc.searchByName('Valheim')).toBeNull();
    expect(await svc.searchById(1)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('configured: fetches with the granted UA header and parses entries', async () => {
    const svc = makeService('RaidLedger/1.0 (granted)');
    const fetchSpy = mockFetch(200, PALWORLD_XML);

    const result = await svc.searchByName('Palworld');

    expect(result).not.toBeNull();
    expect(result!.entries).toHaveLength(1);
    expect(result!.empty).toBe(false);
    const [rawUrl, init] = fetchSpy.mock.calls[0];
    const url = rawUrl as string; // fetchApi always passes a string URL
    expect(url).toContain('api.co-optimus.com/games.php?search=true');
    expect(url).toContain('name=Palworld');
    expect((init!.headers as Record<string, string>)['User-Agent']).toBe(
      'RaidLedger/1.0 (granted)',
    );
  });

  it('testConnection maps a 403 to the honest not-allowlisted message', async () => {
    const svc = makeService('RaidLedger/1.0');
    mockFetch(403, 'challenge page');

    const result = await svc.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('403');
    expect(result.message).toContain('not allowlisted');
  });

  it('testConnection without a UA reports unconfigured, no request', async () => {
    const svc = makeService(null);
    const fetchSpy = jest.spyOn(global, 'fetch');

    const result = await svc.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain('not configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throttle serializes CONCURRENT callers a full rate-limit slot apart', async () => {
    jest.useFakeTimers();
    try {
      const svc = makeService('RaidLedger/1.0');
      const callTimes: number[] = [];
      jest.spyOn(global, 'fetch').mockImplementation(() => {
        callTimes.push(Date.now());
        return Promise.resolve({
          ok: true,
          status: 200,
          text: () => Promise.resolve('<games>\n</games>'),
        } as Response);
      });

      // Two callers enter at the same instant (admin Test during a cron run).
      const both = Promise.all([svc.searchByName('A'), svc.searchByName('B')]);
      await jest.advanceTimersByTimeAsync(COOPTIMUS_RATE_LIMIT_MS * 2 + 50);
      await both;

      expect(callTimes).toHaveLength(2);
      expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(
        COOPTIMUS_RATE_LIMIT_MS,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
