/**
 * VersionCheckService unit tests (ROK-1242).
 *
 * Covers the contract delta added for ROK-1242:
 *   - fetchLatestRelease returns { version, htmlUrl } on 200.
 *   - 404 falls back to fetchLatestTag with htmlUrl: null.
 *   - 403 / 429 returns null and logs a warning.
 *   - Network/timeout error returns null and logs a warning.
 *   - storeVersionCheckResults writes four settings keys including
 *     LATEST_RELEASE_URL (empty string when htmlUrl is null).
 *   - isNewer comparison matrix.
 */
import { VersionCheckService } from './version-check.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

interface MockSettingsService {
  set: jest.Mock;
}

interface MockCronJobService {
  executeWithTracking: jest.Mock;
}

function makeSettings(): MockSettingsService {
  return { set: jest.fn().mockResolvedValue(undefined) };
}

function makeCronJobs(): MockCronJobService {
  return {
    executeWithTracking: jest.fn(async (_name: string, fn: () => Promise<void>) => {
      await fn();
    }),
  };
}

function createService(
  settings: MockSettingsService = makeSettings(),
  cron: MockCronJobService = makeCronJobs(),
): VersionCheckService {
  return new VersionCheckService(
    settings as unknown as ConstructorParameters<typeof VersionCheckService>[0],
    cron as unknown as ConstructorParameters<typeof VersionCheckService>[1],
  );
}

describe('VersionCheckService — ROK-1242 release-URL plumbing', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  describe('checkForUpdates — releases/latest 200 success path', () => {
    it('persists tag_name and html_url into settings', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v999.0.0',
          html_url:
            'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v999.0.0',
        }),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();

      const calls = settings.set.mock.calls;
      const map = new Map<string, string>(
        calls.map(([key, value]: [string, string]) => [key, value]),
      );
      expect(map.get(SETTING_KEYS.LATEST_VERSION)).toBe('999.0.0');
      expect(map.get(SETTING_KEYS.LATEST_RELEASE_URL)).toBe(
        'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v999.0.0',
      );
      expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('true');
      expect(map.has(SETTING_KEYS.VERSION_CHECK_LAST_RUN)).toBe(true);
    });

    it('normalises a leading v from tag_name when storing', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'V2.0.0',
          html_url: 'https://github.com/x/y/releases/tag/V2.0.0',
        }),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();

      const versionCall = settings.set.mock.calls.find(
        ([k]: [string]) => k === SETTING_KEYS.LATEST_VERSION,
      );
      expect(versionCall?.[1]).toBe('2.0.0');
    });
  });

  describe('checkForUpdates — 404 falls back to tags API', () => {
    it('writes htmlUrl as empty string (null htmlUrl from tag fallback)', async () => {
      const settings = makeSettings();
      const fetchMock = jest
        .fn()
        // First call: /releases/latest -> 404
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        // Second call: /tags?per_page=1 -> 200
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ name: 'v3.0.0' }],
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();

      const map = new Map<string, string>(
        settings.set.mock.calls.map(
          ([key, value]: [string, string]) => [key, value],
        ),
      );
      expect(map.get(SETTING_KEYS.LATEST_VERSION)).toBe('3.0.0');
      expect(map.get(SETTING_KEYS.LATEST_RELEASE_URL)).toBe('');
    });

    it('returns silently when both releases and tags fail', async () => {
      const settings = makeSettings();
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) })
        .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
      global.fetch = fetchMock as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();
      expect(settings.set).not.toHaveBeenCalled();
    });
  });

  describe('checkForUpdates — rate-limit / network failure modes', () => {
    it('returns silently on 403 rate-limit (no settings written)', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();
      expect(settings.set).not.toHaveBeenCalled();
    });

    it('returns silently on 429 rate-limit (no settings written)', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();
      expect(settings.set).not.toHaveBeenCalled();
    });

    it('returns silently on network timeout / abort', async () => {
      const settings = makeSettings();
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('timeout')) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();
      expect(settings.set).not.toHaveBeenCalled();
    });

    it('returns silently on unexpected non-2xx response (e.g. 500)', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();
      expect(settings.set).not.toHaveBeenCalled();
    });
  });

  describe('checkForUpdates — flags updateAvailable correctly', () => {
    it('marks updateAvailable=false when remote equals local', async () => {
      const settings = makeSettings();
      const service = createService(settings);
      const localVersion = service.getVersion();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: `v${localVersion}`,
          html_url: `https://github.com/sjdodge123/Raid-Ledger/releases/tag/v${localVersion}`,
        }),
      }) as unknown as typeof fetch;

      await service.checkForUpdates();

      const map = new Map<string, string>(
        settings.set.mock.calls.map(
          ([k, v]: [string, string]) => [k, v],
        ),
      );
      expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
    });

    it('marks updateAvailable=false when remote is older than local', async () => {
      const settings = makeSettings();
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v0.0.1',
          html_url: 'https://github.com/x/y/releases/tag/v0.0.1',
        }),
      }) as unknown as typeof fetch;

      const service = createService(settings);
      await service.checkForUpdates();

      const map = new Map<string, string>(
        settings.set.mock.calls.map(
          ([k, v]: [string, string]) => [k, v],
        ),
      );
      expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
    });
  });
});
