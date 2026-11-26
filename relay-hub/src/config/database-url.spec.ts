import { Logger } from '@nestjs/common';
import { hubPasswordFile, resolveDatabaseUrl } from './database-url';

const MARKER = 'PW-MARKER-7f3a';
const PASSWORD = `a@b/c:${MARKER}`;

function filesReader(files: Record<string, string>) {
  return jest.fn((p: string): string | undefined => files[p]);
}

describe('resolveDatabaseUrl', () => {
  it('uses DATABASE_URL verbatim and never reads the secrets file', () => {
    const readFile = filesReader({ '/data/secrets/db-password': 'x' });
    expect(
      resolveDatabaseUrl({ DATABASE_URL: 'postgres://u:p@h:1/d' }, readFile),
    ).toBe('postgres://u:p@h:1/d');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('derives the embedded URL on 127.0.0.1 from the trimmed, encoded password', () => {
    const readFile = filesReader({
      '/data/secrets/db-password': `${PASSWORD}\n`,
    });
    const url = resolveDatabaseUrl({}, readFile);
    expect(url).toBe(
      `postgres://relayhub:${encodeURIComponent(PASSWORD)}@127.0.0.1:5432/relayhub`,
    );
    expect(url).not.toContain('localhost');
    expect(new URL(url).hostname).toBe('127.0.0.1');
    expect(decodeURIComponent(new URL(url).password)).toBe(PASSWORD);
  });

  it('reads the file under HUB_DATA_DIR, and treats an empty one as /data', () => {
    expect(hubPasswordFile({ HUB_DATA_DIR: '/srv/hub' })).toBe(
      '/srv/hub/secrets/db-password',
    );
    expect(hubPasswordFile({ HUB_DATA_DIR: '' })).toBe(
      '/data/secrets/db-password',
    );
    const readFile = filesReader({ '/srv/hub/secrets/db-password': 'pw' });
    expect(resolveDatabaseUrl({ HUB_DATA_DIR: '/srv/hub' }, readFile)).toBe(
      'postgres://relayhub:pw@127.0.0.1:5432/relayhub',
    );
  });

  it.each([
    ['no file', undefined],
    ['a whitespace-only file', ' \n'],
  ])(
    'throws one error naming DATABASE_URL and the path with %s',
    (_l, body) => {
      const files: Record<string, string> = {};
      if (body !== undefined) files['/data/secrets/db-password'] = body;
      expect(() => resolveDatabaseUrl({}, filesReader(files))).toThrow(
        'relay-hub database is not configured: set DATABASE_URL or create /data/secrets/db-password',
      );
    },
  );
});

describe('resolveDatabaseUrl secrecy', () => {
  it('never puts the password in a thrown message or a log line', () => {
    const spies = [
      ...(['log', 'error', 'warn', 'debug'] as const).map((m) =>
        jest.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
      ),
      ...(['log', 'error', 'warn'] as const).map((m) =>
        jest.spyOn(console, m).mockImplementation(() => undefined),
      ),
    ];
    const withPassword = filesReader({ '/data/secrets/db-password': PASSWORD });
    resolveDatabaseUrl({}, withPassword);
    let message = '';
    try {
      // The password file exists under another dir: the error names the path only.
      resolveDatabaseUrl({ HUB_DATA_DIR: '/elsewhere' }, withPassword);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('/elsewhere/secrets/db-password');
    expect(message).not.toContain(MARKER);
    const logged: string[] = spies.flatMap((s) =>
      s.mock.calls.flat().map((arg: unknown) => String(arg)),
    );
    expect(logged.join('\n')).not.toContain(MARKER);
    spies.forEach((s) => s.mockRestore());
  });
});
