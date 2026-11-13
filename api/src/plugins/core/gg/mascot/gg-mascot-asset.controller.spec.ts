/**
 * ROK-2187 — mascot copies are served by an extensionless API route so the
 * prod nginx static-asset regex (`\.(png|gif|…)$`) never intercepts them.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { GgMascotAssetController } from './gg-mascot-asset.controller';
import { GG_MASCOT_URL_PREFIX, writeMascotFile } from './gg-mascot.storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const OGG = Buffer.from('OggS\0\x02', 'latin1');

function fakeRes(): { res: Response; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    },
  } as unknown as Response;
  return { res, headers };
}

const tokenOf = (url: string): string =>
  url.slice(GG_MASCOT_URL_PREFIX.length).split('?')[0] ?? '';

describe('GgMascotAssetController', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-2187-asset-'));
  const controller = new GgMascotAssetController();
  beforeAll(() => {
    process.env.GG_MASCOT_UPLOAD_DIR = dir;
  });
  afterAll(() => {
    delete process.env.GG_MASCOT_UPLOAD_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('serves the stored image bytes with its content type and a cache header', async () => {
    const url = await writeMascotFile('42', 'png', PNG);
    const { res, headers } = fakeRes();
    const file = await controller.asset(tokenOf(url), res);
    expect(file.getHeaders().type).toBe('image/png');
    expect(headers['cache-control']).toBe('public, max-age=86400');
  });

  it('serves a sound copy as audio', async () => {
    const url = await writeMascotFile('9', 'ogg', OGG);
    const file = await controller.asset(tokenOf(url), fakeRes().res);
    expect(file.getHeaders().type).toBe('audio/ogg');
  });

  it.each(['42.png', '..', '42-exe', 'abc-png', '%2e%2e-png'])(
    '404s a malformed token %s',
    async (token) => {
      await expect(controller.asset(token, fakeRes().res)).rejects.toThrow(
        NotFoundException,
      );
    },
  );

  it('404s a well-formed token whose file does not exist', async () => {
    await expect(controller.asset('777-gif', fakeRes().res)).rejects.toThrow(
      NotFoundException,
    );
  });
});
