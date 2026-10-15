/** ROK-1779: personal-data scrub for api Sentry events. */
import {
  PII_REDACTED,
  scrubPii,
  scrubPiiString,
  type PiiScrubbableEvent,
} from './sentry-pii.helpers';

describe('scrubPii (ROK-1779)', () => {
  it('reduces event.user to its id', () => {
    const event = scrubPii({
      user: { id: 42, username: 'bob', email: 'b@x.io', ip_address: '1.2.3.4' },
    });
    expect(event.user).toEqual({ id: 42 });
  });

  it('redacts PII keys at any depth in extra, contexts, tags and request', () => {
    const event = scrubPii({
      extra: { job: { payload: { username: 'bob', display_name: 'Bob' } } },
      contexts: { app: { displayName: 'Bob', ipAddress: '10.0.0.1' } },
      tags: { 'user.email': 'b@x.io', deployment: 'nas' },
      request: { data: { user_name: 'bob', e_mail: 'nope' } },
    });
    expect(event.extra).toEqual({
      job: { payload: { username: PII_REDACTED, display_name: PII_REDACTED } },
    });
    expect(event.contexts).toEqual({
      app: { displayName: PII_REDACTED, ipAddress: PII_REDACTED },
    });
    expect(event.tags).toEqual({
      'user.email': PII_REDACTED,
      deployment: 'nas',
    });
    expect(event.request).toEqual({
      data: { user_name: PII_REDACTED, e_mail: 'nope' },
    });
  });

  it('redacts appSettings.communityName', () => {
    const event = scrubPii({
      contexts: {
        appSettings: { communityName: 'Night Owls', demoMode: false },
      },
    });
    expect(event.contexts).toEqual({
      appSettings: { communityName: PII_REDACTED, demoMode: false },
    });
  });
});

describe('scrubPii strings (ROK-1779)', () => {
  it('replaces emails and IPs in message, exception value and breadcrumbs', () => {
    const event = scrubPii({
      message: 'login for bob@guild.example from 192.168.1.20',
      exception: {
        values: [{ value: 'peer 2001:db8::8a2e:370:7334 refused' }],
      },
      breadcrumbs: [{ message: 'GET from ::ffff:10.1.2.3 by a.b@c.co' }],
    });
    expect(event.message).toBe('login for [email] from [ip]');
    expect(event.exception?.values?.[0]?.value).toBe('peer [ip] refused');
    expect(event.breadcrumbs).toEqual([
      { message: 'GET from [ip] by [email]' },
    ]);
  });

  it('replaces full and loopback IPv6 literals', () => {
    expect(scrubPiiString('a fe80:0:0:0:200:f8ff:fe21:67cf b ::1 c')).toBe(
      'a [ip] b [ip] c',
    );
  });

  it('leaves version strings, migration tags, times and Rust-style paths', () => {
    const text =
      'node v18.19.0 ran 0001_init at 12:34:56 in Db::query (aa:bb:cc:dd:ee:ff)';
    expect(scrubPiiString(text)).toBe(text);
    const event = scrubPii({
      transaction: 'GET /events/:id',
      message: 'v1.2.3',
    });
    expect(event.transaction).toBe('GET /events/:id');
    expect(event.message).toBe('v1.2.3');
  });

  it('survives a cyclic object', () => {
    const extra: Record<string, unknown> = { email: 'b@x.io' };
    extra['self'] = extra;
    const event: PiiScrubbableEvent = { extra };
    expect(() => scrubPii(event)).not.toThrow();
    expect(extra['email']).toBe(PII_REDACTED);
  });

  it('returns the same event object (beforeSend identity)', () => {
    const event = { message: 'x' };
    expect(scrubPii(event)).toBe(event);
  });
});
