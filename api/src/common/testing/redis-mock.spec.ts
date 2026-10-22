/** ROK-1428 — the in-memory Redis mock's SET NX/XX + PX/EX and its EVAL subset. */
import { COMPARE_AND_DELETE_LUA } from '../redis-lease';
import { createRedisMock } from './redis-mock';

describe('redis-mock set (NX / XX / PX / EX)', () => {
  it('NX sets only when the key is absent', async () => {
    const { client } = createRedisMock();
    expect(await client.set('k', 'a', 'PX', 1000, 'NX')).toBe('OK');
    expect(await client.set('k', 'b', 'PX', 1000, 'NX')).toBeNull();
    expect(await client.get('k')).toBe('a');
  });

  it('XX sets only when the key already exists', async () => {
    const { client } = createRedisMock();
    expect(await client.set('k', 'a', 'XX')).toBeNull();
    expect(await client.get('k')).toBeNull();
    await client.set('k', 'a');
    expect(await client.set('k', 'b', 'XX')).toBe('OK');
    expect(await client.get('k')).toBe('b');
  });

  it('PX and EX record an expiry that ttl reports', async () => {
    const { client } = createRedisMock();
    await client.set('px', 'v', 'PX', 30_000, 'NX');
    await client.set('ex', 'v', 'EX', 60);
    expect(await client.ttl('px')).toBe(30);
    expect(await client.ttl('ex')).toBe(60);
  });
});

describe('redis-mock eval (compare-and-delete only)', () => {
  it('deletes the key when the token matches and returns 1', async () => {
    const { client } = createRedisMock();
    await client.set('lease', 'tok', 'PX', 1000, 'NX');
    expect(await client.eval(COMPARE_AND_DELETE_LUA, 1, 'lease', 'tok')).toBe(
      1,
    );
    expect(await client.get('lease')).toBeNull();
    expect(await client.ttl('lease')).toBe(-2);
  });

  it('leaves a lease held under another token and returns 0', async () => {
    const { client } = createRedisMock();
    await client.set('lease', 'theirs', 'PX', 1000, 'NX');
    expect(await client.eval(COMPARE_AND_DELETE_LUA, 1, 'lease', 'mine')).toBe(
      0,
    );
    expect(await client.get('lease')).toBe('theirs');
  });

  it('returns 0 for a missing key', async () => {
    const { client } = createRedisMock();
    expect(await client.eval(COMPARE_AND_DELETE_LUA, 1, 'gone', 'tok')).toBe(0);
  });

  it('rejects any other script with a clear error', async () => {
    const { client } = createRedisMock();
    await expect(client.eval('return 1', 0)).rejects.toThrow(
      'redis-mock: unsupported EVAL script',
    );
  });
});
