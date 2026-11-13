/**
 * ROK-2187 — community GG mascot API against a real DB: save copies both
 * assets + stores GG_MASCOT; unknown ids 400; unavailable sound 409; oversize
 * / wrong type 422; the copy survives a Discord-side delete; None removes the
 * copies; options are cached (one Discord call per 60 s).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { GgMascotOptionsDto } from '@raid-ledger/contract';
import { getTestApp, type TestApp } from '../../../../common/testing/test-app';
import {
  loginAsAdmin,
  truncateAllTables,
} from '../../../../common/testing/integration-helpers';
import { SettingsService } from '../../../../settings/settings.service';
import { SETTING_KEYS } from '../../../../drizzle/schema';
import {
  GgMascotExpressionSource,
  GgMascotOptionsService,
} from './gg-mascot-options.service';

const MASCOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rok-2187-mascot-'));
process.env.GG_MASCOT_UPLOAD_DIR = MASCOT_DIR;

const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 fake', 'latin1');
const MP3 = Buffer.from('ID3\x04\0\0fake-mp3', 'latin1');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const OPTIONS: GgMascotOptionsDto = {
  emojis: [
    {
      id: '111',
      name: 'wololo',
      animated: false,
      previewUrl: 'https://cdn.discordapp.com/emojis/111.webp',
    },
  ],
  sounds: [
    {
      id: '333',
      name: 'Wololo',
      volume: 0.8,
      available: true,
      emojiName: 'wololo',
    },
    { id: '444', name: 'Locked', volume: 1, available: false, emojiName: null },
    { id: '555', name: 'Huge', volume: 1, available: true, emojiName: null },
    {
      id: '666',
      name: 'NotAudio',
      volume: 1,
      available: true,
      emojiName: null,
    },
  ],
};

const CDN: Record<string, Buffer> = {
  'https://cdn.discordapp.com/emojis/111.webp': WEBP,
  'https://cdn.discordapp.com/soundboard-sounds/333': MP3,
  'https://cdn.discordapp.com/soundboard-sounds/555': Buffer.concat([
    MP3,
    Buffer.alloc(600 * 1024),
  ]),
  'https://cdn.discordapp.com/soundboard-sounds/666': PNG,
};

const realFetch = global.fetch;
let cdnDeleted = false;

function fakeFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  if (!url.startsWith('https://cdn.discordapp.com/'))
    return realFetch(input, init);
  const body = CDN[url];
  if (!body || cdnDeleted)
    return Promise.resolve(new Response(null, { status: 404 }));
  return Promise.resolve(new Response(new Uint8Array(body), { status: 200 }));
}

describe('GG mascot API (integration)', () => {
  let testApp: TestApp;
  let token: string;
  let fetchExpressions: jest.SpyInstance;

  beforeAll(async () => {
    testApp = await getTestApp();
    token = await loginAsAdmin(testApp.request, testApp.seed);
    jest.spyOn(global, 'fetch').mockImplementation(fakeFetch);
  });

  beforeEach(() => {
    cdnDeleted = false;
    testApp.app.get(GgMascotOptionsService).invalidate();
    fetchExpressions = jest
      .spyOn(testApp.app.get(GgMascotExpressionSource), 'fetchExpressions')
      .mockResolvedValue(OPTIONS);
  });

  afterEach(async () => {
    fetchExpressions.mockRestore();
    testApp.seed = await truncateAllTables(testApp.db);
    token = await loginAsAdmin(testApp.request, testApp.seed);
  });

  afterAll(() => {
    jest.restoreAllMocks();
    delete process.env.GG_MASCOT_UPLOAD_DIR;
    fs.rmSync(MASCOT_DIR, { recursive: true, force: true });
  });

  const patch = (body: object) =>
    testApp.request
      .patch('/admin/gg/mascot')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  const get = (url: string) =>
    testApp.request.get(url).set('Authorization', `Bearer ${token}`);

  it('requires auth', async () => {
    await testApp.request.get('/admin/gg/mascot/options').expect(401);
  });

  it('caches options: one Discord call within 60 s', async () => {
    const a = await get('/admin/gg/mascot/options').expect(200);
    await get('/admin/gg/mascot/options').expect(200);
    expect(a.body).toEqual(OPTIONS);
    expect(fetchExpressions).toHaveBeenCalledTimes(1);
  });

  it('503s the options while the bot is offline', async () => {
    fetchExpressions.mockResolvedValue(null);
    await get('/admin/gg/mascot/options').expect(503);
  });

  it('copies emoji + sound into uploads/gg-mascot and stores GG_MASCOT', async () => {
    const res = await patch({ emojiId: '111', soundId: '333' }).expect(200);
    expect(res.body).toMatchObject({
      emojiId: '111',
      emojiName: 'wololo',
      animated: false,
      soundId: '333',
      soundName: 'Wololo',
      volume: 0.8,
    });
    expect(res.body.imageUrl).toMatch(/^\/uploads\/gg-mascot\/111-webp\?v=/);
    expect(res.body.soundUrl).toMatch(/^\/uploads\/gg-mascot\/333-mp3\?v=/);
    expect(fs.readFileSync(path.join(MASCOT_DIR, '111.webp'))).toEqual(WEBP);
    expect(fs.readFileSync(path.join(MASCOT_DIR, '333.mp3'))).toEqual(MP3);
    // Served anonymously from the extensionless URL (prod nginx static regex).
    await testApp.request
      .get(res.body.imageUrl)
      .expect(200)
      .expect('Content-Type', /image\/webp/);
    const stored = await testApp.app
      .get(SettingsService)
      .get(SETTING_KEYS.GG_MASCOT);
    expect(JSON.parse(stored ?? 'null')).toEqual(res.body);
  });

  it('keeps serving the copy after the emoji/sound is deleted in Discord', async () => {
    await patch({ emojiId: '111', soundId: '333' }).expect(200);
    cdnDeleted = true;
    fetchExpressions.mockResolvedValue({ emojis: [], sounds: [] });
    const res = await get('/admin/gg/mascot').expect(200);
    expect(res.body.emojiId).toBe('111');
    expect(fs.existsSync(path.join(MASCOT_DIR, '111.webp'))).toBe(true);
    expect(fs.existsSync(path.join(MASCOT_DIR, '333.mp3'))).toBe(true);
  });

  it('400s an emoji or sound that is not in the guild list', async () => {
    await patch({ emojiId: '999', soundId: null }).expect(400);
    await patch({ emojiId: '111', soundId: '998' }).expect(400);
    await patch({ emojiId: 'not-a-snowflake', soundId: null }).expect(400);
  });

  it('409s an unavailable soundboard sound', async () => {
    await patch({ emojiId: '111', soundId: '444' }).expect(409);
  });

  it('422s an oversize or non-audio sound and stores nothing', async () => {
    await patch({ emojiId: '111', soundId: '555' }).expect(422);
    await patch({ emojiId: '111', soundId: '666' }).expect(422);
    expect(
      await testApp.app.get(SettingsService).get(SETTING_KEYS.GG_MASCOT),
    ).toBeNull();
  });

  it('None deletes the copies and the setting', async () => {
    await patch({ emojiId: '111', soundId: '333' }).expect(200);
    const res = await patch({ emojiId: null, soundId: null }).expect(200);
    expect(['', 'null']).toContain(res.text);
    expect(
      fs.readdirSync(MASCOT_DIR).filter((f) => !f.startsWith('.')),
    ).toEqual([]);
    expect(
      await testApp.app.get(SettingsService).get(SETTING_KEYS.GG_MASCOT),
    ).toBeNull();
  });

  it('streams a sound preview with its sniffed type; 404 for a foreign id', async () => {
    const res = await get('/admin/gg/mascot/sounds/333/preview').expect(200);
    expect(res.headers['content-type']).toMatch(/^audio\/mpeg/);
    expect(res.headers['cache-control']).toBe('private, no-store');
    await get('/admin/gg/mascot/sounds/777/preview').expect(404);
  });
});
