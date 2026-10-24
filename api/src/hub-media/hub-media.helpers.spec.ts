import sharp from 'sharp';
import {
  HUB_MEDIA_MAX_DOWNLOAD_BYTES,
  HubMediaDownloadError,
  fetchHubMediaDownloader,
  parseAllowedSourceUrl,
} from './hub-media-download';
import { encodeHubMedia, sniffHubMediaImage } from './hub-media.encode';
import { mediaFilePath } from './hub-media.paths';
import { solidPng } from './hub-media.testing';
import { discordProvenanceKey } from './hub-media.types';

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';

describe('sniffHubMediaImage', () => {
  it('accepts png and rejects text claiming to be an image', async () => {
    expect(sniffHubMediaImage(await solidPng(4, 4))).toBe('png');
    expect(
      sniffHubMediaImage(Buffer.from('<svg>not an image</svg>')),
    ).toBeNull();
    expect(sniffHubMediaImage(Buffer.from('RIFF0000WAVE'))).toBeNull();
  });
});

describe('encodeHubMedia', () => {
  it('bounds the full to 2048 on the longest side and crops a 480² thumb', async () => {
    const out = await encodeHubMedia(await solidPng(4096, 1024));
    expect(out).not.toBeNull();
    expect(out?.width).toBe(2048);
    expect(out?.height).toBe(512);
    const full = await sharp(out?.full).metadata();
    const thumb = await sharp(out?.thumb).metadata();
    expect([full.format, full.width, full.height]).toEqual(['webp', 2048, 512]);
    expect([thumb.format, thumb.width, thumb.height]).toEqual([
      'webp',
      480,
      480,
    ]);
  });

  it('never enlarges a small picture', async () => {
    const out = await encodeHubMedia(await solidPng(300, 200));
    expect([out?.width, out?.height]).toEqual([300, 200]);
  });

  it('returns null for non-image and for truncated image bytes', async () => {
    expect(await encodeHubMedia(Buffer.from('hello world'))).toBeNull();
    const png = await solidPng(64, 64);
    expect(await encodeHubMedia(png.subarray(0, 20))).toBeNull();
  });
});

describe('parseAllowedSourceUrl', () => {
  it('allows only https Discord CDN hosts', () => {
    expect(
      parseAllowedSourceUrl('https://cdn.discordapp.com/a/1/2/x.png')?.hostname,
    ).toBe('cdn.discordapp.com');
    expect(
      parseAllowedSourceUrl('https://media.discordapp.net/a.png'),
    ).not.toBeNull();
    for (const bad of [
      'http://cdn.discordapp.com/a.png',
      'https://evil.example/a.png',
      'https://cdn.discordapp.com.evil.example/a.png',
      'https://user:pw@cdn.discordapp.com/a.png',
      'https://cdn.discordapp.com:8443/a.png',
      'https://169.254.169.254/latest',
      'not a url',
    ]) {
      expect({ bad, url: parseAllowedSourceUrl(bad) }).toEqual({
        bad,
        url: null,
      });
    }
  });
});

describe('fetchHubMediaDownloader', () => {
  const url = new URL('https://cdn.discordapp.com/a.png');
  afterEach(() => jest.restoreAllMocks());

  it('refuses a body past the cap with too_large and does not retry', async () => {
    const big = new Response(new Uint8Array(HUB_MEDIA_MAX_DOWNLOAD_BYTES + 1));
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(big);
    await expect(fetchHubMediaDownloader.download(url)).rejects.toEqual(
      new HubMediaDownloadError('too_large'),
    );
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('retries once after a failed response, then returns the bytes', async () => {
    const spy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 503 }))
      .mockResolvedValueOnce(new Response(Buffer.from('ok')));
    expect((await fetchHubMediaDownloader.download(url)).toString()).toBe('ok');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('paths + provenance', () => {
  it('builds the discord provenance key', () => {
    expect(
      discordProvenanceKey({
        channelId: '1',
        messageId: '2',
        attachmentId: '3',
      }),
    ).toBe('discord:1:2:3');
  });

  it('never lets a non-uuid storage name or a bad guild id become a path', () => {
    process.env.HUB_MEDIA_DIR = '/tmp/hm';
    expect(mediaFilePath(7, UUID, 'thumb')).toBe(
      `/tmp/hm/7/${UUID}.thumb.webp`,
    );
    expect(() => mediaFilePath(7, '../../etc/passwd', 'full')).toThrow(
      'invalid storage name',
    );
    expect(() => mediaFilePath(-1, UUID, 'full')).toThrow('invalid guild id');
    delete process.env.HUB_MEDIA_DIR;
  });
});
