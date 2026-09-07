/**
 * VersionCheckService — commit-vs-main comparison (ROK-1393).
 *
 * When COMMIT_SHA is set (every image built by ci.yml docker-build), the
 * service compares the running commit against origin/main's head via the
 * GitHub commits API and flags an update only when main is more than 30 h
 * newer. When COMMIT_SHA is unset, the semver-vs-release path still runs.
 */
import { VersionCheckService } from './version-check.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

interface MockSettingsService {
  set: jest.Mock;
}

const RUNNING = '74b92a06' + 'a'.repeat(32);
const MAIN = '3ab490ab' + 'b'.repeat(32);
const T0 = '2026-09-05T05:00:00Z';
const HOUR_MS = 60 * 60 * 1000;
const COMPARE_URL =
  'https://github.com/sjdodge123/Raid-Ledger/compare/74b92a0...3ab490a';

function plusHours(iso: string, hours: number): string {
  return new Date(Date.parse(iso) + hours * HOUR_MS).toISOString();
}

function makeSettings(): MockSettingsService {
  return { set: jest.fn().mockResolvedValue(undefined) };
}

function createService(settings: MockSettingsService): VersionCheckService {
  const cron = {
    executeWithTracking: jest.fn(
      async (_name: string, fn: () => Promise<void>) => fn(),
    ),
  };
  return new VersionCheckService(
    settings as unknown as ConstructorParameters<typeof VersionCheckService>[0],
    cron as unknown as ConstructorParameters<typeof VersionCheckService>[1],
  );
}

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

function commitBody(sha: string, date: string) {
  return { sha, commit: { committer: { date } } };
}

function mockCommitsApi(mainDate: string, runningDate: string = T0): jest.Mock {
  const fetchMock = jest.fn((url: string) =>
    Promise.resolve(
      url.endsWith('/commits/main')
        ? jsonResponse(200, commitBody(MAIN, mainDate))
        : jsonResponse(200, commitBody(RUNNING, runningDate)),
    ),
  );
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function settingsMap(settings: MockSettingsService): Map<string, string> {
  return new Map<string, string>(
    settings.set.mock.calls.map(([k, v]: [string, string]) => [k, v]),
  );
}

describe('VersionCheckService — commit-vs-main comparison (ROK-1393)', () => {
  const originalCommitSha = process.env.COMMIT_SHA;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.COMMIT_SHA = RUNNING;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalCommitSha === undefined) delete process.env.COMMIT_SHA;
    else process.env.COMMIT_SHA = originalCommitSha;
    jest.clearAllMocks();
  });

  it('marks updateAvailable=true when main head is 31h newer than the running commit', async () => {
    const settings = makeSettings();
    const fetchMock = mockCommitsApi(plusHours(T0, 31));

    await createService(settings).checkForUpdates();

    const map = settingsMap(settings);
    expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('true');
    expect(map.get(SETTING_KEYS.LATEST_VERSION)).toBe(MAIN.slice(0, 7));
    expect(map.get(SETTING_KEYS.LATEST_RELEASE_URL)).toBe(COMPARE_URL);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/commits/main'),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/commits/${RUNNING}`),
      expect.anything(),
    );
  });

  it('marks updateAvailable=false when main head is only 29h newer', async () => {
    const settings = makeSettings();
    mockCommitsApi(plusHours(T0, 29));

    await createService(settings).checkForUpdates();

    expect(settingsMap(settings).get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe(
      'false',
    );
  });

  it('marks updateAvailable=false and skips the second fetch when running sha equals main head', async () => {
    const settings = makeSettings();
    const fetchMock = jest.fn(() =>
      Promise.resolve(jsonResponse(200, commitBody(RUNNING, T0))),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await createService(settings).checkForUpdates();

    const map = settingsMap(settings);
    expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
    expect(map.get(SETTING_KEYS.LATEST_RELEASE_URL)).toBe('');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('skips writing settings on 403 from the commits API', async () => {
    const settings = makeSettings();
    global.fetch = jest.fn().mockResolvedValue(jsonResponse(403, {}));

    await createService(settings).checkForUpdates();

    expect(settings.set).not.toHaveBeenCalled();
  });

  it('skips writing settings when the running commit is unknown to GitHub (404)', async () => {
    const settings = makeSettings();
    global.fetch = jest.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/commits/main')
          ? jsonResponse(200, commitBody(MAIN, plusHours(T0, 100)))
          : jsonResponse(404, {}),
      ),
    ) as unknown as typeof fetch;

    await createService(settings).checkForUpdates();

    expect(settings.set).not.toHaveBeenCalled();
  });

  it('getRunningBuildLabel returns the short COMMIT_SHA', () => {
    expect(createService(makeSettings()).getRunningBuildLabel()).toBe(
      RUNNING.slice(0, 7),
    );
  });

  it('falls back to the releases/semver comparison when COMMIT_SHA is unset', async () => {
    delete process.env.COMMIT_SHA;
    const settings = makeSettings();
    const fetchMock = jest.fn().mockResolvedValue(
      jsonResponse(200, {
        tag_name: 'v999.0.0',
        html_url:
          'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v999.0.0',
      }),
    );
    global.fetch = fetchMock;

    const service = createService(settings);
    await service.checkForUpdates();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/releases/latest'),
      expect.anything(),
    );
    expect(settingsMap(settings).get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe(
      'true',
    );
    expect(service.getRunningBuildLabel()).toBe(service.getVersion());
  });
});
