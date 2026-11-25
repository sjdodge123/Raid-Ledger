import { readFileSync } from 'fs';
import * as path from 'path';

const events: string[] = [];
const captureException = jest.fn((err: unknown, ctx: unknown) => {
  events.push('capture');
  return { err, ctx };
});
const flush = jest.fn(async (timeout: number) => {
  events.push(`flush(${timeout})`);
  await new Promise((resolve) => setImmediate(resolve));
  events.push('flushed');
  return true;
});
jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  captureException,
  flush,
}));

import { runCli } from './run-migrations';

const DEAD_URL = 'postgres://x:y@127.0.0.1:1/none';

function firstImport(file: string): string | undefined {
  const source = readFileSync(path.resolve(__dirname, file), 'utf8');
  return source.match(/^import\s.*$/m)?.[0];
}

describe('run-migrations boot failure (AC 2)', () => {
  beforeEach(() => {
    events.length = 0;
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('captures with boot.migration, awaits flush(2000), then exits 1', async () => {
    const exit = jest.fn((code: number) => events.push(`exit(${code})`));
    await runCli([], { DATABASE_URL: DEAD_URL }, exit);
    expect(events).toEqual(['capture', 'flush(2000)', 'flushed', 'exit(1)']);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { context: 'boot.migration' },
    });
  });

  it('reports a missing database config the same way', async () => {
    const exit = jest.fn((code: number) => events.push(`exit(${code})`));
    await runCli([], { HUB_DATA_DIR: '/nonexistent-relay-hub' }, exit);
    expect(events).toEqual(['capture', 'flush(2000)', 'flushed', 'exit(1)']);
  });
});

describe('Sentry instrument is the first import (AC 8)', () => {
  it.each([
    ['../main.ts', "import './sentry/instrument';"],
    ['./run-migrations.ts', "import '../sentry/instrument';"],
  ])('%s', (file, expected) => {
    expect(firstImport(file)).toMatch(
      new RegExp(`^${expected.replace(/[./]/g, '\\$&')}`),
    );
  });
});
