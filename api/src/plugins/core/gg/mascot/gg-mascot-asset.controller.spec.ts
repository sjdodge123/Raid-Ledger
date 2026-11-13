/**
 * ROK-2187 — mascot copies are served by an extensionless API route so the
 * prod nginx static-asset regex (`\.(png|gif|…)$`) never intercepts them,
 * through Express `sendFile` so WebKit audio gets Range/206, ETag and 304.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { GgMascotAssetController } from './gg-mascot-asset.controller';
import { GG_MASCOT_URL_PREFIX, writeMascotFile } from './gg-mascot.storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OGG = Buffer.from('OggS\0\x02fake-ogg-body', 'latin1');

const pathOf = (url: string): string => url.split('?')[0] ?? '';

describe('GgMascotAssetController', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-2187-asset-'));
  let app: INestApplication;
  let http: Parameters<typeof request>[0];
  beforeAll(async () => {
    process.env.GG_MASCOT_UPLOAD_DIR = dir;
    const mod = await Test.createTestingModule({
      controllers: [GgMascotAssetController],
    }).compile();
    app = mod.createNestApplication();
    await app.init();
    http = app.getHttpServer() as Parameters<typeof request>[0];
  });
  afterAll(async () => {
    await app.close();
    delete process.env.GG_MASCOT_UPLOAD_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves the stored image bytes with its content type and a cache header', async () => {
    const url = await writeMascotFile('42', 'png', PNG);
    const res = await request(http).get(pathOf(url)).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    expect(Buffer.from(res.body as Buffer)).toEqual(PNG);
  });

  it('serves a byte range of a sound as 206 audio (WebKit <audio>)', async () => {
    const url = await writeMascotFile('9', 'ogg', OGG);
    const res = await request(http)
      .get(pathOf(url))
      .set('Range', 'bytes=0-9')
      .expect(206);
    expect(res.headers['content-type']).toBe('audio/ogg');
    expect(res.headers['content-range']).toBe(`bytes 0-9/${OGG.length}`);
    expect(res.headers['content-length']).toBe('10');
  });

  it('answers a matching If-None-Match with 304', async () => {
    const url = await writeMascotFile('43', 'png', PNG);
    const first = await request(http).get(pathOf(url));
    const etag = String(first.headers['etag'] ?? '');
    expect(etag).not.toBe('');
    await request(http).get(pathOf(url)).set('If-None-Match', etag).expect(304);
  });

  it.each(['42.png', '..', '42-exe', 'abc-png', '%2e%2e-png', '.42-png'])(
    '404s a malformed token %s',
    async (token) => {
      await request(http).get(`${GG_MASCOT_URL_PREFIX}${token}`).expect(404);
    },
  );

  it('404s a well-formed token whose file does not exist', async () => {
    await request(http).get(`${GG_MASCOT_URL_PREFIX}777-gif`).expect(404);
  });
});
