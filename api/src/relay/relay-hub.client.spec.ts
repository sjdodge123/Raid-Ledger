import { readFileSync } from 'fs';
import { join } from 'path';
import {
  disconnectFromHub,
  heartbeatHub,
  registerWithHub,
} from './relay-hub.client';

const HUB = 'http://192.168.0.10:3600';
const INSTANCE_ID = '7f8c2d1e-4b5a-4c3d-9e8f-1a2b3c4d5e6f';
const STAT_KEYS = ['playerCount', 'eventCount', 'activeGames', 'uptimeSeconds'];

const validRegister = {
  token: 'rlh_abc123',
  instanceId: INSTANCE_ID,
  trustTier: 'reader',
  schemaVersion: 1,
  epoch: 'e1',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** The parsed JSON body of the n-th fetch call. */
function sentBody(spy: jest.SpyInstance, n = 0): Record<string, unknown> {
  const init = spy.mock.calls[n]?.[1] as RequestInit | undefined;
  if (typeof init?.body !== 'string') throw new Error('no string body sent');
  return JSON.parse(init.body) as Record<string, unknown>;
}

let fetchSpy: jest.SpyInstance;
beforeEach(() => {
  fetchSpy = jest.spyOn(global, 'fetch');
});
afterEach(() => fetchSpy.mockRestore());

describe('registerWithHub', () => {
  it('POSTs exactly instanceId, schemaVersion and version (AC 2, 6)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, validRegister));
    await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(fetchSpy).toHaveBeenCalledWith(
      `${HUB}/api/v1/instances/register`,
      expect.objectContaining({ method: 'POST', signal: expect.any(Object) }),
    );
    const body = sentBody(fetchSpy);
    expect(Object.keys(body).sort()).toEqual([
      'instanceId',
      'schemaVersion',
      'version',
    ]);
    expect(body).toEqual({
      instanceId: INSTANCE_ID,
      schemaVersion: 1,
      version: '1.2.3',
    });
    for (const key of STAT_KEYS) expect(body).not.toHaveProperty(key);
  });

  it('returns the parsed response on a 2xx', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(201, validRegister));
    const result = await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(result).toEqual({ ok: true, data: validRegister });
  });

  it.each([
    ['a missing token', { ...validRegister, token: undefined }],
    ['a token without rlh_', { ...validRegister, token: 'abc123' }],
  ])('rejects a 2xx with %s as malformed (AC 8)', async (_l, body) => {
    fetchSpy.mockResolvedValue(jsonResponse(200, body));
    const result = await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(result).toEqual({ ok: false, status: 200, reason: 'malformed' });
  });

  it('rejects a 2xx whose body is not JSON, without throwing', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>', { status: 200 }));
    const result = await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(result).toEqual({ ok: false, status: 200, reason: 'malformed' });
  });

  it('reports a non-2xx with its status', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(403, { error: 'revoked' }));
    const result = await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(result).toEqual({ ok: false, status: 403, reason: 'HTTP 403' });
  });

  it('reports a network error without throwing', async () => {
    fetchSpy.mockRejectedValue(new Error('fetch failed'));
    const result = await registerWithHub(HUB, INSTANCE_ID, '1.2.3');
    expect(result).toEqual({ ok: false, reason: 'fetch failed' });
  });
});

describe('heartbeatHub', () => {
  const validHeartbeat = {
    schemaVersion: 1,
    epoch: 'e1',
    serverTime: '2026-11-25T00:00:00.000Z',
  };

  it('POSTs exactly schemaVersion and version with the bearer (AC 6)', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, validHeartbeat));
    const result = await heartbeatHub(HUB, INSTANCE_ID, 'rlh_t', '1.2.3');
    expect(result).toEqual({ ok: true, data: validHeartbeat });
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `${HUB}/api/v1/instances/${INSTANCE_ID}/heartbeat`,
    );
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer rlh_t' });
    const body = sentBody(fetchSpy);
    expect(Object.keys(body).sort()).toEqual(['schemaVersion', 'version']);
    for (const key of STAT_KEYS) expect(body).not.toHaveProperty(key);
  });

  it('reports a 401 with its status', async () => {
    fetchSpy.mockResolvedValue(jsonResponse(401, { error: 'unauthorized' }));
    const result = await heartbeatHub(HUB, INSTANCE_ID, 'rlh_t', '1.2.3');
    expect(result).toEqual({ ok: false, status: 401, reason: 'HTTP 401' });
  });
});

describe('disconnectFromHub', () => {
  it('DELETEs the instance with the bearer and never throws', async () => {
    fetchSpy.mockRejectedValue(new Error('down'));
    const result = await disconnectFromHub(HUB, INSTANCE_ID, 'rlh_t');
    expect(result).toEqual({ ok: false, reason: 'down' });
    expect(fetchSpy).toHaveBeenCalledWith(
      `${HUB}/api/v1/instances/${INSTANCE_ID}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});

describe('usage stats are gone (AC 6)', () => {
  it('no relay source file defines gatherStats', () => {
    for (const file of ['relay.service.ts', 'relay-hub.client.ts']) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect(src).not.toMatch(/gatherStats/);
      for (const key of STAT_KEYS) expect(src).not.toContain(key);
    }
  });
});
