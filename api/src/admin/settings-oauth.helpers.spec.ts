/**
 * ROK-1703 D-5: `oauth/test` body parsing and the typed-pair path of
 * testDiscordOAuth (the setup wizard's live ID + secret check).
 */
import { BadRequestException } from '@nestjs/common';
import { parseOAuthTestBody, testDiscordOAuth } from './settings-oauth.helpers';

const APP_ID = '1290017734588641280';
const SECRET = 'abcdefghijklmnopqrstuvwxyz012345';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

function authHeaderOf(call: unknown[] | undefined): string {
  const init = call?.[1] as RequestInit | undefined;
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers.Authorization ?? '';
}

describe('parseOAuthTestBody', () => {
  it.each([undefined, null, {}])('treats %p as "test the saved pair"', (b) => {
    expect(parseOAuthTestBody(b)).toBeNull();
  });

  it('returns the trimmed typed pair', () => {
    expect(
      parseOAuthTestBody({
        clientId: ` ${APP_ID} `,
        clientSecret: ` ${SECRET}`,
      }),
    ).toEqual({ clientId: APP_ID, clientSecret: SECRET });
  });

  it.each([
    ['a short id', { clientId: '12345', clientSecret: SECRET }],
    [
      'a non-numeric id',
      { clientId: 'abcdefghijklmnopqr', clientSecret: SECRET },
    ],
    ['a missing secret', { clientId: APP_ID }],
    [
      'an over-long secret',
      { clientId: APP_ID, clientSecret: 'x'.repeat(129) },
    ],
    ['an unknown key', { clientId: APP_ID, clientSecret: SECRET, extra: 1 }],
  ])('rejects %s with a 400', (_label, b) => {
    expect(() => parseOAuthTestBody(b)).toThrow(BadRequestException);
  });

  it('never echoes the submitted secret in the 400', () => {
    const secret = 'y'.repeat(129);
    try {
      parseOAuthTestBody({ clientId: APP_ID, clientSecret: secret });
      throw new Error('expected a 400');
    } catch (error) {
      expect(
        JSON.stringify((error as BadRequestException).getResponse()),
      ).not.toContain(secret);
    }
  });
});

describe('testDiscordOAuth with a typed pair', () => {
  const fetchSpy = jest.spyOn(global, 'fetch');
  afterEach(() => fetchSpy.mockReset());
  afterAll(() => fetchSpy.mockRestore());

  it('sends the typed pair as Basic auth and reports invalid_client as a failure', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(401, { error: 'invalid_client' }),
    );
    const result = await testDiscordOAuth(
      { clientId: APP_ID, clientSecret: SECRET },
      'typed',
    );
    expect(result).toEqual({
      success: false,
      message: 'Invalid Client ID or Client Secret',
    });
    const expected = `Basic ${Buffer.from(`${APP_ID}:${SECRET}`).toString('base64')}`;
    expect(authHeaderOf(fetchSpy.mock.calls[0])).toBe(expected);
  });

  it('accepts a pair Discord authenticates', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { access_token: 'x' }));
    const result = await testDiscordOAuth(
      { clientId: APP_ID, clientSecret: SECRET },
      'typed',
    );
    expect(result.success).toBe(true);
  });

  it.each([
    ['a 429', new Response('{"message":"rate limited"}', { status: 429 })],
    [
      'a non-JSON block page',
      new Response('<html>blocked</html>', { status: 403 }),
    ],
  ])(
    '%s on the token endpoint leaves the typed pair unverified, never accepted',
    async (_label, blocked) => {
      fetchSpy
        .mockResolvedValueOnce(blocked)
        .mockResolvedValueOnce(jsonResponse(200, { url: 'wss://gateway' }));
      const result = await testDiscordOAuth(
        { clientId: APP_ID, clientSecret: SECRET },
        'typed',
      );
      expect(result).toEqual({
        success: false,
        retryable: true,
        message:
          "Discord is busy and couldn't check the ID and secret right now. Try again in a moment.",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    },
  );
});
