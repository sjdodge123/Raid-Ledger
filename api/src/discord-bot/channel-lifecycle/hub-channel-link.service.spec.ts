/**
 * ROK-1871 (ROK-1428 §2.7, D7) — unit: the auto-link eligibility rule and the
 * service's delegation to its queries. Real-DB behaviour (R15–R17) lives in
 * `hub-channel-link.integration.spec.ts` (fleet-only).
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../../drizzle/schema';
import * as queries from './hub-channel-link.queries';
import { isAutoLinkable } from './hub-channel-link.queries';
import { HubChannelLinkService } from './hub-channel-link.service';

describe('isAutoLinkable (D7)', () => {
  it('no profile row → linkable', () => {
    expect(isAutoLinkable({ channelId: null, source: null })).toBe(true);
  });

  it('profile with a NULL channel and NULL source → linkable', () => {
    expect(isAutoLinkable({ channelId: null, source: null })).toBe(true);
  });

  it("an 'auto' row whose channel was nulled → linkable", () => {
    expect(isAutoLinkable({ channelId: null, source: 'auto' })).toBe(true);
  });

  it("a 'manual' clear (NULL channel) is an explicit no-channel → not linkable", () => {
    expect(isAutoLinkable({ channelId: null, source: 'manual' })).toBe(false);
  });

  it('a channel already set (any source) → not linkable', () => {
    expect(isAutoLinkable({ channelId: '1', source: 'auto' })).toBe(false);
    expect(isAutoLinkable({ channelId: '1', source: 'manual' })).toBe(false);
    expect(isAutoLinkable({ channelId: '1', source: null })).toBe(false);
  });
});

describe('HubChannelLinkService', () => {
  const db = drizzle.mock({ schema });
  const service = new HubChannelLinkService(db);

  afterEach(() => jest.restoreAllMocks());

  it('linkHubsForGame returns the count of linked hubs', async () => {
    const spy = jest.spyOn(queries, 'linkHubsForGame').mockResolvedValue(2);
    await expect(service.linkHubsForGame(7, 'chan-1')).resolves.toBe(2);
    expect(spy).toHaveBeenCalledWith(db, 7, 'chan-1');
  });

  it('hubNeedsLinkGameIds returns the set of games', async () => {
    jest
      .spyOn(queries, 'selectHubNeedsLinkGameIds')
      .mockResolvedValue(new Set([3, 4]));
    await expect(service.hubNeedsLinkGameIds()).resolves.toEqual(
      new Set([3, 4]),
    );
  });

  it('managedForChannel returns the managed game, or null', async () => {
    const spy = jest
      .spyOn(queries, 'findManagedForChannel')
      .mockResolvedValueOnce({ gameId: 9, gameName: 'Valheim' })
      .mockResolvedValueOnce(null);
    await expect(service.managedForChannel('c')).resolves.toEqual({
      gameId: 9,
      gameName: 'Valheim',
    });
    await expect(service.managedForChannel('d')).resolves.toBeNull();
    expect(spy).toHaveBeenCalledWith(db, 'c');
  });
});
