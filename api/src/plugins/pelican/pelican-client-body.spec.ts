import { inspect } from 'node:util';
import { Logger } from '@nestjs/common';
import { PelicanClient, type PelicanResult } from './pelican-client';
import { fetchErrorKind } from './pelican-client.helpers';
import { loadPelicanFixture } from './testing/pelican-fixtures';

const KEY = 'pacc_FAKEKEYfortests0123456789';
const BASE = 'https://panel.example.test/';
const TWO_MIB = 2 * 1_048_576;

function clientFor(response: Response, timeoutMs?: number) {
  return new PelicanClient({
    baseUrl: BASE,
    apiKey: KEY,
    fetchImpl: () => Promise.resolve(response),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

function errorOf<T>(result: PelicanResult<T>) {
  if (result.ok) throw new Error('expected a failed result, got ok');
  return result.error;
}

/** A body stream that records whether the client cancelled it. */
function trackedStream(pull?: (c: ReadableStreamDefaultController) => void) {
  const state = { cancelled: false, bytesServed: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!pull) return new Promise<void>(() => {});
      pull(controller);
      return undefined;
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

afterEach(() => jest.restoreAllMocks());
beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

describe('PelicanClient bounded body read', () => {
  it('stops an endless body at 1 MiB, cancels it and reports bad_response', async () => {
    const { stream, state } = trackedStream((c) => {
      state.bytesServed += 65_536;
      c.enqueue(new Uint8Array(65_536));
    });
    const result = await clientFor(new Response(stream)).listServers();
    expect(errorOf(result)).toEqual({ kind: 'bad_response', status: 200 });
    expect(state.cancelled).toBe(true);
    expect(state.bytesServed).toBeLessThan(TWO_MIB);
  });

  it('rejects a declared Content-Length over the cap without parsing', async () => {
    const body = JSON.stringify(loadPelicanFixture('servers-page'));
    const response = new Response(body, {
      headers: { 'Content-Length': String(TWO_MIB) },
    });
    expect(errorOf(await clientFor(response).listServers())).toEqual({
      kind: 'bad_response',
      status: 200,
    });
  });

  it('still parses a normal body read through the bounded reader', async () => {
    const body = JSON.stringify(loadPelicanFixture('servers-page'));
    const result = await clientFor(new Response(body)).listServers();
    expect(result.ok).toBe(true);
  });

  it.each([401, 429, 500])(
    'cancels the unread body of an HTTP %p',
    async (status) => {
      const { stream, state } = trackedStream();
      await clientFor(new Response(stream, { status })).listServers();
      expect(state.cancelled).toBe(true);
    },
  );

  it('reports a timeout that fires while the body is streaming as timeout', async () => {
    const { stream } = trackedStream();
    const result = await clientFor(new Response(stream), 5).listServers();
    expect(errorOf(result).kind).toBe('timeout');
  });
});

describe('fetchErrorKind is realm-independent', () => {
  it('reads the redirect cause from a non-instanceof error object', () => {
    const foreign = {
      name: 'TypeError',
      message: 'fetch failed',
      cause: { name: 'Error', message: 'unexpected redirect' },
    };
    expect(foreign instanceof Error).toBe(false);
    expect(fetchErrorKind(foreign)).toBe('redirect');
  });

  it('reads a timeout name nested in the cause chain', () => {
    const wrapped = new TypeError('fetch failed', {
      cause: { name: 'TimeoutError', message: 'deadline' },
    });
    expect(fetchErrorKind(wrapped)).toBe('timeout');
  });

  it('does not call a DNS failure for a host named "redirect" a redirect', () => {
    const dns = new TypeError('fetch failed', {
      cause: new Error('getaddrinfo ENOTFOUND redirect.lan'),
    });
    expect(fetchErrorKind(dns)).toBe('network');
  });
});

describe('PelicanClient key storage', () => {
  it('keeps the key out of JSON.stringify, Object.keys and util.inspect', () => {
    const client = clientFor(new Response('{}'));
    expect(JSON.stringify(client)).not.toContain(KEY);
    expect(Object.keys(client)).not.toContain('apiKey');
    expect(inspect(client, { depth: 5 })).not.toContain(KEY);
  });
});
