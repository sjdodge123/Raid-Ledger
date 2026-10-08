import {
  CalendarProviderError,
  NotFoundError,
  ProviderAuthError,
  ProviderNotConfiguredError,
  RateLimitError,
  TransientError,
} from './calendar-provider.errors';

describe('calendar provider errors', () => {
  it.each([
    [new ProviderAuthError('invalid_grant'), 'auth', 'ProviderAuthError'],
    [new RateLimitError(30_000, 'http_429'), 'rate_limited', 'RateLimitError'],
    [new TransientError('http_503'), 'transient', 'TransientError'],
    [new NotFoundError('http_410'), 'not_found', 'NotFoundError'],
    [
      new ProviderNotConfiguredError('google'),
      'not_configured',
      'ProviderNotConfiguredError',
    ],
  ])('%s carries its code, name and safe reason', (err, code, name) => {
    expect(err).toBeInstanceOf(CalendarProviderError);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe(code);
    expect(err.name).toBe(name);
    expect(err.message).toContain(`(${err.reason})`);
    expect(err.reason).not.toBe('unspecified');
  });

  it('keeps the retry delay on a RateLimitError', () => {
    expect(new RateLimitError(30_000).retryAfterMs).toBe(30_000);
  });

  it.each([
    'ya29.a0AfH6SMBxSecretAccessToken',
    '4/0AY0e-g7QxSecretAuthCode',
    'https://oauth2.googleapis.com/token?code=abc',
    'Bearer abc',
    'x'.repeat(49),
  ])('never puts an unsafe reason %p in the message', (reason) => {
    const err = new ProviderAuthError(reason);
    expect(err.reason).toBe('unspecified');
    expect(String(err)).not.toContain(reason);
    expect(err.message).toBe(
      'Calendar provider rejected the credentials (unspecified)',
    );
  });
});
