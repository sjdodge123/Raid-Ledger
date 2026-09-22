/**
 * VersionCheckService — commit-vs-main comparison (ROK-1393, reworked by
 * ROK-1475 into the build-level `fixes_available` signal).
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

const RELEASE = {
  tag_name: 'v1.1.0',
  html_url: 'https://github.com/sjdodge123/Raid-Ledger/releases/tag/v1.1.0',
};

function compareBody(messages: string[]) {
  return {
    ahead_by: messages.length,
    commits: messages.map((message) => ({ commit: { message } })),
  };
}

/** Routes releases / commits/main / compare; running build is v1.1.0. */
function mockGitHub(opts: {
  mainSha: string;
  compare: ReturnType<typeof compareBody> | 403 | null;
}): jest.Mock {
  process.env.APP_VERSION = 'v1.1.0';
  const fetchMock = jest.fn((url: string) => {
    if (url.includes('/releases/latest')) {
      return Promise.resolve(jsonResponse(200, RELEASE));
    }
    if (url.endsWith('/commits/main')) {
      return Promise.resolve(jsonResponse(200, commitBody(opts.mainSha, T0)));
    }
    if (url.includes('/compare/') && opts.compare !== null) {
      return Promise.resolve(
        opts.compare === 403
          ? jsonResponse(403, {})
          : jsonResponse(200, opts.compare),
      );
    }
    return Promise.resolve(jsonResponse(500, {}));
  });
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
  const originalAppVersion = process.env.APP_VERSION;
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
    if (originalAppVersion === undefined) delete process.env.APP_VERSION;
    else process.env.APP_VERSION = originalAppVersion;
  });

  // ROK-1475 changed these three cases: the commit comparison no longer
  // drives UPDATE_AVAILABLE (now the feature-level release signal). It feeds
  // the build-level FIXES_AVAILABLE count instead, via the compare API, and
  // the 30 h isBehindMain threshold no longer gates it (a fix is a fix).
  it('records the fix: count and compare URL when main is ahead, without touching UPDATE_AVAILABLE', async () => {
    const settings = makeSettings();
    const fetchMock = mockGitHub({
      mainSha: MAIN,
      compare: compareBody(['fix(a): x', 'chore: y', 'fix: z', 'feat: w']),
    });

    await createService(settings).checkForUpdates();

    const map = settingsMap(settings);
    expect(map.get(SETTING_KEYS.FIXES_AVAILABLE)).toBe('2');
    expect(map.get(SETTING_KEYS.LATEST_COMMIT_SHA)).toBe(MAIN.slice(0, 7));
    expect(map.get(SETTING_KEYS.FIXES_COMPARE_URL)).toBe(COMPARE_URL);
    expect(map.get(SETTING_KEYS.FIXES_COMPUTED_FOR_SHA)).toBe(
      RUNNING.slice(0, 7),
    );
    expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/compare/${RUNNING}...${MAIN}`),
      expect.anything(),
    );
  });

  it('records fixes even when main is only minutes ahead (no 30 h gate)', async () => {
    const settings = makeSettings();
    mockGitHub({ mainSha: MAIN, compare: compareBody(['fix: one']) });

    await createService(settings).checkForUpdates();

    expect(settingsMap(settings).get(SETTING_KEYS.FIXES_AVAILABLE)).toBe('1');
  });

  it('writes fixesAvailable=0 and skips the compare call when running sha equals main head', async () => {
    const settings = makeSettings();
    const fetchMock = mockGitHub({ mainSha: RUNNING, compare: null });

    await createService(settings).checkForUpdates();

    const map = settingsMap(settings);
    expect(map.get(SETTING_KEYS.FIXES_AVAILABLE)).toBe('0');
    expect(map.get(SETTING_KEYS.FIXES_COMPARE_URL)).toBe('');
    const urls = fetchMock.mock.calls.map(([u]: [string]) => u);
    expect(urls.filter((u) => u.includes('/compare/'))).toEqual([]);
  });

  it('keeps the previous fixes values when the compare API is rate-limited', async () => {
    const settings = makeSettings();
    mockGitHub({ mainSha: MAIN, compare: 403 });

    await createService(settings).checkForUpdates();

    const map = settingsMap(settings);
    expect(map.has(SETTING_KEYS.FIXES_AVAILABLE)).toBe(false);
    expect(map.get(SETTING_KEYS.UPDATE_AVAILABLE)).toBe('false');
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
