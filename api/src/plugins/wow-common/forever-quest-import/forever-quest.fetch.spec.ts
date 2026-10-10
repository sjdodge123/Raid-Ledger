import { createRetryingGetter } from './forever-quest.fetch';

const ok = (body: string): Response =>
  ({ ok: true, status: 200, text: () => Promise.resolve(body) }) as Response;

function getter(fetchFn: jest.Mock, maxRequests = 10) {
  return createRetryingGetter({
    fetchFn,
    schedule: (task) => task(),
    maxRequests,
    maxTries: 3,
    userAgent: 'test-ua',
  });
}

describe('createRetryingGetter', () => {
  it('retries a rejected fetch and returns the body on the third try', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('ENOTFOUND'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(ok('page'));
    await expect(getter(fetchFn)('https://x/quest=1')).resolves.toBe('page');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns null after three rejected attempts', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ENOTFOUND'));
    await expect(getter(fetchFn)('https://x/quest=1')).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('returns null on 404 without retrying', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(getter(fetchFn)('https://x/quest=1')).resolves.toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('throws once the request cap is exceeded', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('down'));
    await expect(getter(fetchFn, 2)('https://x/quest=1')).rejects.toThrow(
      /request cap 2/,
    );
  });
});
