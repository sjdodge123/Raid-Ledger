/**
 * ROK-1872: the shared card-refresh helper adds the event's hub link to an
 * already-built context — same lookup as the poster; no hub ⇒ unchanged.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import { resolveEventHubLink } from './embed-hub-link.helpers';
import { withEventHubLink } from './embed-event-context.helpers';

jest.mock('./embed-hub-link.helpers', () => ({
  ...jest.requireActual<object>('./embed-hub-link.helpers'),
  resolveEventHubLink: jest.fn(),
}));

const resolve = jest.mocked(resolveEventHubLink);
const db = {} as PostgresJsDatabase<typeof schema>;
const logger = { warn: jest.fn() };
const HUB = { url: 'https://x.test/guilds/7', label: 'Hub' as const };
const CTX = {
  communityName: 'G',
  clientUrl: 'https://x.test',
  timezone: 'UTC',
};

describe('withEventHubLink (ROK-1872)', () => {
  beforeEach(() => resolve.mockReset());

  it('adds the resolved hub link using the context client URL', async () => {
    resolve.mockResolvedValueOnce(HUB);
    const ctx = await withEventHubLink(db, CTX, 42, logger);
    expect(ctx).toEqual({ ...CTX, hubLink: HUB });
    expect(resolve).toHaveBeenCalledWith(db, 42, 'https://x.test', logger);
  });

  it('returns a context deep-equal to the input when there is no hub', async () => {
    resolve.mockResolvedValueOnce(null);
    const ctx = await withEventHubLink(db, CTX, 42, logger);
    expect(ctx).toStrictEqual(CTX);
    expect('hubLink' in ctx).toBe(false);
  });

  it('passes a null client URL through', async () => {
    resolve.mockResolvedValueOnce(null);
    await withEventHubLink(db, { clientUrl: null, timezone: 'UTC' }, 9, logger);
    expect(resolve).toHaveBeenCalledWith(db, 9, null, logger);
  });
});
