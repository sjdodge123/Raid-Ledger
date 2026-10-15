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
});

describe('PII scrub boundaries: versions, real IPs, camelCase keys (ROK-1779)', () => {
  it('leaves real Chrome, Edge, Firefox and Android user agents intact', () => {
    const uas = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0',
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
    ];
    for (const ua of uas) expect(scrubPiiString(ua)).toBe(ua);
    const event = scrubPii({
      request: { headers: { 'User-Agent': uas[0] } },
      contexts: { browser: { name: 'Chrome', version: '141.0.0.0' } },
    });
    expect(event.request).toEqual({ headers: { 'User-Agent': uas[0] } });
    expect(event.contexts).toEqual({
      browser: { name: 'Chrome', version: '141.0.0.0' },
    });
  });

  it('still scrubs real IPv4/IPv6 addresses in URLs, headers and paths', () => {
    expect(
      scrubPiiString(
        'from 192.168.1.20 via http://10.0.0.5:3000/x /ips/8.8.8.8 ip=172.16.0.1.',
      ),
    ).toBe('from [ip] via http://[ip]:3000/x /ips/[ip] ip=[ip].');
    expect(scrubPiiString('x-forwarded-for: 203.0.113.9, 2001:db8::1')).toBe(
      'x-forwarded-for: [ip], [ip]',
    );
    expect(scrubPiiString('not ips: 999.1.1.1 and 1.2.3.4.5')).toBe(
      'not ips: 999.1.1.1 and 1.2.3.4.5',
    );
  });

  it('redacts camelCase PII keys but not look-alikes', () => {
    const event = scrubPii({
      extra: {
        discordUsername: 'bob',
        userEmail: 'x',
        ownerDisplayName: 'Bob',
        clientIpAddress: 'x',
        hostname: 'raid.example',
        voicemail: 'on',
      },
    });
    expect(event.extra).toEqual({
      discordUsername: PII_REDACTED,
      userEmail: PII_REDACTED,
      ownerDisplayName: PII_REDACTED,
      clientIpAddress: PII_REDACTED,
      hostname: 'raid.example',
      voicemail: 'on',
    });
  });
});

describe('scrubPii strings — identity and cycles (ROK-1779)', () => {
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
