/**
 * ROK-2187 — mascot copy guards: magic-byte sniff, size caps, snowflake-only
 * file names, prune keeps only the current copies.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { UnprocessableEntityException } from '@nestjs/common';
import {
  MASCOT_IMAGE_MAX_BYTES,
  MASCOT_SOUND_MAX_BYTES,
  assertMascotAsset,
  mascotFileFromUrl,
  mascotFileName,
  removeMascotFiles,
  sniffMascotAsset,
  writeMascotFile,
} from './gg-mascot.storage';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF = Buffer.from('GIF89a....', 'latin1');
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const OGG = Buffer.from('OggS\0\x02', 'latin1');
const ID3 = Buffer.from('ID3\x04\0\0', 'latin1');
const MP3_FRAME = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

describe('sniffMascotAsset', () => {
  it('recognises png, gif and webp images', () => {
    expect([PNG, GIF, WEBP].map((b) => sniffMascotAsset(b, 'image'))).toEqual([
      'png',
      'gif',
      'webp',
    ]);
  });
  it('recognises ogg, ID3 mp3 and frame-sync mp3 sounds', () => {
    expect(
      [OGG, ID3, MP3_FRAME].map((b) => sniffMascotAsset(b, 'sound')),
    ).toEqual(['ogg', 'mp3', 'mp3']);
  });
  it('refuses a sound posing as an image and vice versa', () => {
    expect(sniffMascotAsset(OGG, 'image')).toBeNull();
    expect(sniffMascotAsset(PNG, 'sound')).toBeNull();
    expect(sniffMascotAsset(Buffer.from('<svg/>'), 'image')).toBeNull();
  });
});

describe('assertMascotAsset', () => {
  it('returns the sniffed extension within the cap', () => {
    expect(assertMascotAsset(PNG, 'image')).toBe('png');
  });
  it('422s an image over 256 KB and a sound over 512 KB', () => {
    const bigImage = Buffer.concat([PNG, Buffer.alloc(MASCOT_IMAGE_MAX_BYTES)]);
    const bigSound = Buffer.concat([OGG, Buffer.alloc(MASCOT_SOUND_MAX_BYTES)]);
    expect(() => assertMascotAsset(bigImage, 'image')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertMascotAsset(bigSound, 'sound')).toThrow(
      UnprocessableEntityException,
    );
  });
  it('422s an empty or wrong-type asset', () => {
    expect(() => assertMascotAsset(Buffer.alloc(0), 'image')).toThrow(
      UnprocessableEntityException,
    );
    expect(() => assertMascotAsset(PNG, 'sound')).toThrow(
      /not an allowed type/,
    );
  });
});

describe('mascot file names', () => {
  it('only builds {snowflake}.{ext}', () => {
    expect(mascotFileName('123', 'gif')).toBe('123.gif');
    expect(() => mascotFileName('../x', 'gif')).toThrow(
      UnprocessableEntityException,
    );
  });
  it('maps a stored url back to its file and ignores foreign urls', () => {
    expect(mascotFileFromUrl('/uploads/gg-mascot/123.png?v=abcd')).toBe(
      '123.png',
    );
    expect(mascotFileFromUrl('/uploads/branding/logo.png')).toBeNull();
    expect(mascotFileFromUrl('/uploads/gg-mascot/../x.png')).toBeNull();
    expect(mascotFileFromUrl(null)).toBeNull();
  });
});

describe('write + prune', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-2187-mascot-unit-'));
  beforeAll(() => {
    process.env.GG_MASCOT_UPLOAD_DIR = dir;
  });
  afterAll(() => {
    delete process.env.GG_MASCOT_UPLOAD_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the copy and returns a versioned same-origin url', async () => {
    const url = await writeMascotFile('42', 'png', PNG);
    expect(url).toMatch(/^\/uploads\/gg-mascot\/42\.png\?v=[a-f0-9]{8}$/);
    expect(fs.readFileSync(path.join(dir, '42.png'))).toEqual(PNG);
  });
  it('removes every copy except the kept ones, leaving foreign files', async () => {
    await writeMascotFile('7', 'ogg', OGG);
    fs.writeFileSync(path.join(dir, 'README.txt'), 'x');
    await removeMascotFiles(new Set(['7.ogg']));
    expect(fs.readdirSync(dir).sort()).toEqual(['7.ogg', 'README.txt']);
  });
});
