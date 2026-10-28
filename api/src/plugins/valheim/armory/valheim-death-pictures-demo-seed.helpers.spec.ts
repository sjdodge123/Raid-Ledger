/** ROK-1941 L6 — the death-pictures demo seed's body parse + stub downloader. */
import { BadRequestException } from '@nestjs/common';
import {
  demoDeathDownloader,
  parseDeathPicturesBody,
  topCharacter,
} from './valheim-death-pictures-demo-seed.helpers';

describe('parseDeathPicturesBody', () => {
  it('defaults worker 0, count 5, no hidden or removed picture', () => {
    expect(parseDeathPicturesBody(undefined)).toEqual({
      worker: 0,
      count: 5,
      hidden: false,
      removed: false,
      secondCount: 0,
      screenshot: false,
    });
  });

  it.each([
    { count: 0 },
    { count: 25 },
    { worker: -1 },
    { extra: 1 },
    { secondCount: -1 },
    { secondCount: 25 },
  ])('400s %p', (body) => {
    expect(() => parseDeathPicturesBody(body)).toThrow(BadRequestException);
  });
});

describe('demoDeathDownloader', () => {
  it('generates a PNG without touching the network', async () => {
    const png = await demoDeathDownloader.download(
      new URL('https://cdn.discordapp.com/attachments/demo-death/2.png'),
    );
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
  });
});

describe('topCharacter', () => {
  it("is the Deaths fixture's SteamID-attributed top character", () => {
    expect(topCharacter(3)).toEqual({
      name: 'Ulfgrimr',
      steamId: '76561198019300030',
    });
  });
});
