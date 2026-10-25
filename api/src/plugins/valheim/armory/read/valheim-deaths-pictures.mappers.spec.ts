/**
 * ROK-1941 D13 — death pictures fold onto the Deaths bars through the same
 * bucket merge as the counts (ROK-1930 D7): newest 3 across every bucket of
 * the bar, `pictureCount` summed, both fields absent on a bar with none.
 */
import type {
  DeathGroupRow,
  DeathProfileRow,
} from '../valheim-deaths.repository';
import { toDeathsResponse } from './valheim-deaths.mappers';
import type { DeathPictureBucket } from './valheim-deaths-pictures.mappers';

const A = '76561198000000001';
const HUB = 4;
const at = (h: number) => new Date(Date.UTC(2026, 9, 20, h));
const group = (o: Partial<DeathGroupRow>): DeathGroupRow => ({
  steamId: null,
  characterName: 'Ragnar',
  deaths: 1,
  firstDeathAt: at(1),
  lastDeathAt: at(1),
  ...o,
});
const prof: DeathProfileRow = {
  id: 9,
  steamId: A,
  name: 'Ragnar',
  capturedAt: at(0),
};
const pic = (mediaId: number, h: number) => ({
  mediaId,
  guildId: HUB,
  capturedAt: at(h),
});
const bucket = (o: Partial<DeathPictureBucket>): DeathPictureBucket => ({
  steamId: null,
  characterName: 'Ragnar',
  count: 0,
  pictures: [],
  ...o,
});
const thumb = (id: number) => `/hubs/${HUB}/media/${id}/thumb`;

describe('toDeathsResponse — death pictures (ROK-1941 D13)', () => {
  it('merges a NULL-steam bucket into the SteamID bar: newest 3 across buckets, count summed', () => {
    const groups = [
      group({ steamId: A, deaths: 3 }),
      group({ steamId: null, deaths: 2 }),
    ];
    const pictures = [
      bucket({ steamId: A, count: 3, pictures: [pic(11, 9), pic(12, 5), pic(13, 2)] }),
      bucket({ steamId: null, count: 2, pictures: [pic(21, 7), pic(22, 1)] }),
    ];
    const [bar] = toDeathsResponse({ groups, profiles: [prof] }, pictures)
      .players;
    expect({
      ids: bar?.pictures?.map((p) => p.mediaId),
      count: bar?.pictureCount,
    }).toEqual({ ids: [11, 21, 12], count: 5 });
    expect(bar?.pictures?.[0]).toEqual({
      mediaId: 11,
      thumbPath: thumb(11),
      capturedAt: at(9).toISOString(),
    });
  });

  it('breaks a capturedAt tie by the newer media id', () => {
    const pictures = [
      bucket({ count: 2, pictures: [pic(5, 3), pic(8, 3)] }),
    ];
    const [bar] = toDeathsResponse(
      { groups: [group({})], profiles: [] },
      pictures,
    ).players;
    expect(bar?.pictures?.map((p) => p.mediaId)).toEqual([8, 5]);
  });

  it('omits pictures and pictureCount on a bar with no visible pictures', () => {
    const out = toDeathsResponse(
      { groups: [group({ characterName: 'Bjorn' })], profiles: [] },
      [bucket({ characterName: 'Other', count: 1, pictures: [pic(1, 1)] })],
    ).players;
    expect(out).toEqual([
      {
        key: 'nBjorn',
        name: 'Bjorn',
        deaths: 1,
        lastDeathAt: at(1).toISOString(),
        characterId: null,
      },
    ]);
  });

  it('keeps the counts-only call (no pictures argument) unchanged', () => {
    const [bar] = toDeathsResponse({ groups: [group({})], profiles: [] })
      .players;
    expect(Object.keys(bar ?? {}).sort()).toEqual([
      'characterId',
      'deaths',
      'key',
      'lastDeathAt',
      'name',
    ]);
  });
});
