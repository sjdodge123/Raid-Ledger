/**
 * ROK-1595 G-3 (Q-A): `applyFirstConnectRead` turns read on for a FIRST
 * connect whose grant carries the read scopes, and touches nothing else.
 * The Postgres path is pinned by `calendar-oauth.integration.spec.ts`.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  createDrizzleMock,
  type MockDb,
} from '../../common/testing/drizzle-mock';
import * as schema from '../../drizzle/schema';
import {
  GOOGLE_CONNECT_SCOPES,
  GOOGLE_READ_SCOPES,
} from '../providers/google/google-oauth.helpers';
import {
  applyFirstConnectRead,
  grantAllowsRead,
  type FirstConnectReadInput,
} from './calendar-read-consent.helpers';

describe('grantAllowsRead (ROK-1598 T25)', () => {
  it('Apple is read-capable with no scope step', () => {
    expect(grantAllowsRead('apple', [])).toBe(true);
  });

  it('Google still needs the read scopes', () => {
    expect(grantAllowsRead('google', [])).toBe(false);
    expect(grantAllowsRead('google', GOOGLE_READ_SCOPES)).toBe(true);
  });
});

const WRITE_ONLY = GOOGLE_CONNECT_SCOPES.split(' ');
const WITH_READ = [...WRITE_ONLY, ...GOOGLE_READ_SCOPES];

let mockDb: MockDb;

function run(over: Partial<FirstConnectReadInput> = {}) {
  const db = mockDb as unknown as PostgresJsDatabase<typeof schema>;
  return applyFirstConnectRead(db, {
    intent: 'connect',
    created: true,
    connectionId: 9,
    provider: 'google',
    grantedScopes: WITH_READ,
    ...over,
  });
}

beforeEach(() => {
  mockDb = createDrizzleMock();
});

describe('applyFirstConnectRead', () => {
  it('first connect with the read scopes sets only the two read flags', async () => {
    expect(await run()).toBe(true);
    expect(mockDb.update).toHaveBeenCalledWith(schema.calendarConnections);
    const [set] = mockDb.set.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(set).sort()).toEqual([
      'readAccessGranted',
      'readEnabled',
      'updatedAt',
    ]);
    expect(set).toMatchObject({ readAccessGranted: true, readEnabled: true });
  });

  it.each<[string, Partial<FirstConnectReadInput>]>([
    [
      'a grant without the read boxes (write-only)',
      { grantedScopes: WRITE_ONLY },
    ],
    ['a reconnect (keeps the user read choice)', { created: false }],
    ['intent=read (its own branch)', { intent: 'read' }],
    ['a non-Google provider', { provider: 'microsoft' }],
  ])('leaves the row alone for %s', async (_label, over) => {
    expect(await run(over)).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
