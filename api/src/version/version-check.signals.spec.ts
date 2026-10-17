/**
 * ROK-1475 AC3 — the two update signals, verified side by side.
 *
 * `updateAvailable` (feature level) moves only when a newer GitHub release
 * exists; `fixesAvailable` (build level) counts the `fix:` commits on main
 * the running build lacks. The story's exact accident — a fix-only span
 * flipping the feature banner — is quadrant 2.
 */
import { VersionCheckService } from './version-check.service';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

const RUNNING = 'c0ffee1' + '0'.repeat(33);
const MAIN = 'deadbee' + 'f'.repeat(33);

type Json = { status: number; body: unknown };
const ok = (body: unknown): Json => ({ status: 200, body });

function release(tag: string): Json {
  return ok({
    tag_name: tag,
    html_url: `https://github.com/sjdodge123/Raid-Ledger/releases/tag/${tag}`,
  });
}

function compare(messages: string[]): Json {
  return ok({
    ahead_by: messages.length,
    commits: messages.map((message) => ({ commit: { message } })),
  });
}

function route(routes: { release: Json; main?: string; compare?: Json }) {
  return jest.fn((url: string) => {
    let hit: Json = { status: 500, body: {} };
    if (url.includes('/releases/latest')) hit = routes.release;
    else if (url.endsWith('/commits/main') && routes.main) {
      hit = ok({ sha: routes.main, commit: { committer: { date: 'x' } } });
    } else if (url.includes('/compare/') && routes.compare) {
      hit = routes.compare;
    }
    return Promise.resolve({
      ok: hit.status === 200,
      status: hit.status,
      json: () => Promise.resolve(hit.body),
    });
  });
}

async function runCheck(
  env: { commitSha?: string },
  fetchMock: jest.Mock,
): Promise<Map<string, string>> {
  process.env.APP_VERSION = 'v1.1.0';
  if (env.commitSha) process.env.COMMIT_SHA = env.commitSha;
  else delete process.env.COMMIT_SHA;
  global.fetch = fetchMock;
  const set = jest.fn().mockResolvedValue(undefined);
  const cron = { executeWithTracking: jest.fn() };
  const service = new VersionCheckService(
    { set } as unknown as ConstructorParameters<typeof VersionCheckService>[0],
    cron as unknown as ConstructorParameters<typeof VersionCheckService>[1],
  );
  await service.checkForUpdates();
  return new Map(set.mock.calls.map(([k, v]: [string, string]) => [k, v]));
}

function signals(map: Map<string, string>) {
  return {
    updateAvailable: map.get(SETTING_KEYS.UPDATE_AVAILABLE),
    fixesAvailable: map.get(SETTING_KEYS.FIXES_AVAILABLE),
  };
}

describe('VersionCheckService — feature vs build signals (ROK-1475 AC3)', () => {
  const saved = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...saved };
    global.fetch = originalFetch;
  });

  it('Q1: v1.1.0 image on main head → no update, 0 fixes', async () => {
    const map = await runCheck(
      { commitSha: RUNNING },
      route({ release: release('v1.1.0'), main: RUNNING }),
    );
    expect(signals(map)).toEqual({
      updateAvailable: 'false',
      fixesAvailable: '0',
    });
  });

  it('Q2: fix-only span (3 fix + 2 chore), no newer release → updateAvailable FALSE, 3 fixes', async () => {
    const span = [
      'fix: a',
      'chore: b',
      'fix(events): c',
      'chore: d',
      'fix!: e',
    ];
    const map = await runCheck(
      { commitSha: RUNNING },
      route({ release: release('v1.1.0'), main: MAIN, compare: compare(span) }),
    );
    expect(signals(map)).toEqual({
      updateAvailable: 'false',
      fixesAvailable: '3',
    });
  });

  it('Q3: a v1.2.0 release exists → updateAvailable TRUE, fixes still counted', async () => {
    const map = await runCheck(
      { commitSha: RUNNING },
      route({
        release: release('v1.2.0'),
        main: MAIN,
        compare: compare(['feat: x', 'fix: y']),
      }),
    );
    expect(signals(map)).toEqual({
      updateAvailable: 'true',
      fixesAvailable: '1',
    });
    expect(map.get(SETTING_KEYS.LATEST_VERSION)).toBe('1.2.0');
  });

  it('Q4: no COMMIT_SHA (local dev), newer release → update true, fixes never written (null, not 0)', async () => {
    const fetchMock = route({ release: release('v1.2.0') });
    const map = await runCheck({}, fetchMock);
    expect(signals(map)).toEqual({
      updateAvailable: 'true',
      fixesAvailable: undefined,
    });
    const urls = fetchMock.mock.calls.map(([u]: [string]) => u);
    expect(urls.filter((u) => !u.includes('/releases/latest'))).toEqual([]);
  });

  it('releases API 403 → no feature keys written, build half still writes', async () => {
    const map = await runCheck(
      { commitSha: RUNNING },
      route({
        release: { status: 403, body: {} },
        main: MAIN,
        compare: compare(['fix: a']),
      }),
    );
    expect(signals(map)).toEqual({
      updateAvailable: undefined,
      fixesAvailable: '1',
    });
    expect(map.has(SETTING_KEYS.LATEST_VERSION)).toBe(false);
  });

  it('compare API 403 → feature result still written, fixes keys untouched', async () => {
    const map = await runCheck(
      { commitSha: RUNNING },
      route({
        release: release('v1.2.0'),
        main: MAIN,
        compare: { status: 403, body: {} },
      }),
    );
    expect(signals(map)).toEqual({
      updateAvailable: 'true',
      fixesAvailable: undefined,
    });
    expect(map.has(SETTING_KEYS.FIXES_COMPARE_URL)).toBe(false);
  });
});
