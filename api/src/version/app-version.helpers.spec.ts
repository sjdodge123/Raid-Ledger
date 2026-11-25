import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveAppVersion } from './app-version.helpers';

const packageVersion = (
  JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

describe('resolveAppVersion (ROK-1676 AC 7)', () => {
  it('uses APP_VERSION when set, without the leading v', () => {
    expect(resolveAppVersion({ APP_VERSION: 'v2.4.1' })).toBe('2.4.1');
  });

  it('falls back to package.json when APP_VERSION is unset or blank', () => {
    expect(resolveAppVersion({})).toBe(packageVersion);
    expect(resolveAppVersion({ APP_VERSION: '' })).toBe(packageVersion);
  });
});
