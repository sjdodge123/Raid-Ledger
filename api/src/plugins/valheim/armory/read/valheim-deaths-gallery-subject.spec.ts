/**
 * ROK-2027 D1/D6 — the Valheim `valheim-death:<bar key>` Gallery subject
 * resolver: refuses a malformed key (null → 400),
 * answers [] for a hub with no server or no such bar, and otherwise hands
 * back the media ids linked to that bar's death buckets.
 */
import type { DeathCounts } from '../valheim-deaths.repository';
import type { DeathBucketRef } from './valheim-deaths.mappers';
import { deathSubjectResolver } from './valheim-deaths-gallery-subject';

const A = '76561198000000001';
const at = new Date(Date.UTC(2026, 9, 20, 1));
const counts: DeathCounts = {
  groups: [
    {
      steamId: A,
      characterName: 'Ragnar',
      deaths: 2,
      firstDeathAt: at,
      lastDeathAt: at,
    },
    {
      steamId: null,
      characterName: 'Bjorn',
      deaths: 1,
      firstDeathAt: at,
      lastDeathAt: at,
    },
  ],
  profiles: [{ id: 42, steamId: A, name: 'Ragnar', capturedAt: at }],
};

function setup(serverId: number | null = 5) {
  const countByPlayer = jest.fn<Promise<DeathCounts>, [number]>(() =>
    Promise.resolve(counts),
  );
  const serverIdOfHub = jest.fn<Promise<number | null>, [number]>(() =>
    Promise.resolve(serverId),
  );
  const mediaIdsFor = jest.fn<Promise<number[]>, [number, DeathBucketRef[]]>(
    () => Promise.resolve([11, 12]),
  );
  const resolver = deathSubjectResolver({
    countByPlayer,
    serverIdOfHub,
    mediaIdsFor,
  });
  const resolve = (payload: string) => resolver({ guildId: 9, payload });
  return { resolve, serverIdOfHub, mediaIdsFor };
}

describe('ValheimDeathsGallerySubject (ROK-2027)', () => {
  it("returns the media ids of a character bar's buckets", async () => {
    const { resolve, serverIdOfHub, mediaIdsFor } = setup();
    await expect(resolve('c42')).resolves.toEqual([11, 12]);
    expect(serverIdOfHub).toHaveBeenCalledWith(9);
    expect(mediaIdsFor).toHaveBeenCalledWith(5, [
      { steamId: A, characterName: 'Ragnar' },
    ]);
  });

  it('resolves a name-only bar key', async () => {
    const { resolve, mediaIdsFor } = setup();
    await resolve('nBjorn');
    expect(mediaIdsFor).toHaveBeenCalledWith(5, [
      { steamId: null, characterName: 'Bjorn' },
    ]);
  });

  it('refuses a malformed key with null (core answers 400)', async () => {
    const { resolve, serverIdOfHub } = setup();
    for (const bad of ['', 'x42', 'c0', 'c', 'n']) {
      await expect(resolve(bad)).resolves.toBeNull();
    }
    expect(serverIdOfHub).not.toHaveBeenCalled();
  });

  it('answers [] for a hub with no Pelican server, without a lookup', async () => {
    const { resolve, mediaIdsFor } = setup(null);
    await expect(resolve('c42')).resolves.toEqual([]);
    expect(mediaIdsFor).not.toHaveBeenCalled();
  });

  it('answers [] for a well-formed key no bar carries (stale key)', async () => {
    const { resolve, mediaIdsFor } = setup();
    await expect(resolve('c999')).resolves.toEqual([]);
    expect(mediaIdsFor).not.toHaveBeenCalled();
  });
});
