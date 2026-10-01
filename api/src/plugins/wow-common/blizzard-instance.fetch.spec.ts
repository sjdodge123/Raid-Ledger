import { BadGatewayException, NotFoundException } from '@nestjs/common';
import { fetchInstanceDetailFromApi } from './blizzard-instance.fetch';

/**
 * TDB:1784: a failed journal-instance call must surface as a 502 with a
 * readable message, not a raw Error that Nest turns into a bare 500.
 * Instance id 63 is below 10000, so it takes the real API path rather than
 * the synthetic sub-instance lookup.
 */
describe('fetchInstanceDetailFromApi — upstream failures', () => {
  afterEach(() => jest.restoreAllMocks());

  function mockStatus(status: number) {
    return jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response('upstream', { status })),
      );
  }

  it('maps a 5xx to a 502 try-again error', async () => {
    const fetchSpy = mockStatus(503);
    const call = () => fetchInstanceDetailFromApi(63, 'us', 'retail', 'tok');
    await expect(call()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call()).rejects.toThrow(
      'Failed to fetch instance detail from Blizzard (503). Please try again later.',
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/data/wow/journal-instance/63?'),
      expect.anything(),
    );
  });

  it('maps a 404 (unknown journal-instance id) to a 404, not a retry 502', async () => {
    mockStatus(404);
    const call = () => fetchInstanceDetailFromApi(63, 'us', 'retail', 'tok');
    await expect(call()).rejects.toBeInstanceOf(NotFoundException);
    await expect(call()).rejects.toHaveProperty(
      'message',
      'Instance 63 not found',
    );
  });

  it('maps a 403 to a 502 saying instances are not served', async () => {
    mockStatus(403);
    const call = () =>
      fetchInstanceDetailFromApi(63, 'us', 'classic_era', 'tok');
    await expect(call()).rejects.toBeInstanceOf(BadGatewayException);
    await expect(call()).rejects.toHaveProperty(
      'message',
      "Blizzard's API doesn't serve instances for this game version yet (403).",
    );
  });
});
