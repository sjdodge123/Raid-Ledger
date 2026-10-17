/**
 * ROK-1716 — the Forever namespace canary only REPORTS (ruling 2026-10-04):
 * PASS with a details line, SKIP when it cannot run, never FAIL.
 */
import { probeForeverNamespace } from './blizzard-forever.canary';

const SKYBORNE_URL_PART = 'playable-race/index?namespace=static-classicforever';

type Handler = (url: string) => Response;

let fetchSpy: jest.SpyInstance;
let requested: string[];

function stubFetch(handler: Handler): void {
  requested = [];
  fetchSpy = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : input.toString();
      requested.push(url);
      return Promise.resolve(handler(url));
    });
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status });

/** OAuth succeeds; every Game Data URL 404s unless `override` answers. */
function blizzard(override?: (url: string) => Response | undefined): Handler {
  return (url) => {
    if (url.includes('oauth/token')) return json({ access_token: 't' });
    return override?.(url) ?? json({}, 404);
  };
}

afterEach(() => fetchSpy.mockRestore());

describe('probeForeverNamespace (ROK-1716 canary)', () => {
  it('passes with "no Forever namespace yet" and probes us only', async () => {
    stubFetch(blizzard());
    const result = await probeForeverNamespace('id', 'secret');
    expect(result).toEqual({
      status: 'PASS',
      details: 'no Forever namespace yet',
    });
    const dataUrls = requested.filter((u) => u.includes('api.blizzard.com'));
    expect(dataUrls).toHaveLength(7 * 3);
    expect(dataUrls.every((u) => u.startsWith('https://us.'))).toBe(true);
  });

  it('passes with "FOUND: <prefix>" when a candidate has Skyborne', async () => {
    stubFetch(
      blizzard((url) =>
        url.includes(SKYBORNE_URL_PART)
          ? json({ races: [{ id: 99, name: 'Skyborne' }] })
          : undefined,
      ),
    );
    const result = await probeForeverNamespace('id', 'secret');
    expect(result).toEqual({
      status: 'PASS',
      details: 'FOUND: classicforever',
    });
  });

  it('skips (never fails) when Battle.net OAuth is refused', async () => {
    stubFetch(() => json({ error: 'unauthorized' }, 401));
    const result = await probeForeverNamespace('id', 'secret');
    expect(result.status).toBe('SKIP');
    expect(result.reason).toMatch(/OAuth/);
  });

  it('skips (never fails) when the network throws', async () => {
    requested = [];
    fetchSpy = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNRESET'));
    const result = await probeForeverNamespace('id', 'secret');
    expect(result.status).toBe('SKIP');
    expect(result.reason).toMatch(/ECONNRESET/);
  });
});
