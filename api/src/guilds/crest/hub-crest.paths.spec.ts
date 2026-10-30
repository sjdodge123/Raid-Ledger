import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import {
  GUILD_CREST_URL_PREFIX,
  crestFilePath,
  crestPublicUrl,
  deleteCrestFiles,
  getGuildCrestDir,
  isGuildCrestKey,
  writeCrestFiles,
} from './hub-crest.paths';

const KEY = '0123456789abcdef0123456789abcdef';

const saved = { dir: process.env.GUILD_CREST_DIR, env: process.env.NODE_ENV };
let root = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'crest-'));
  process.env.GUILD_CREST_DIR = root;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (saved.dir === undefined) delete process.env.GUILD_CREST_DIR;
  else process.env.GUILD_CREST_DIR = saved.dir;
  process.env.NODE_ENV = saved.env;
});

describe('hub-crest path building', () => {
  it('roots at GUILD_CREST_DIR, else the prod / dev default', () => {
    expect(getGuildCrestDir()).toBe(root);
    delete process.env.GUILD_CREST_DIR;
    process.env.NODE_ENV = 'production';
    expect(getGuildCrestDir()).toBe('/data/uploads/guild-crests');
    process.env.NODE_ENV = 'development';
    expect(getGuildCrestDir()).toBe(
      path.join(process.cwd(), 'uploads', 'guild-crests'),
    );
  });

  it('builds <root>/<guildId>/<key>.<size>.webp and the public url', () => {
    expect(crestFilePath(7, KEY, 'sm')).toBe(
      path.join(root, '7', `${KEY}.sm.webp`),
    );
    expect(crestFilePath(7, KEY, 'lg')).toBe(
      path.join(root, '7', `${KEY}.lg.webp`),
    );
    expect(GUILD_CREST_URL_PREFIX).toBe('/uploads/guild-crests/');
    expect(crestPublicUrl(7, KEY, 'lg')).toBe(
      `/uploads/guild-crests/7/${KEY}.lg.webp`,
    );
  });

  it.each([
    '../../etc/passwd',
    `${KEY}/../x`,
    KEY.toUpperCase(),
    KEY.slice(1),
    `${KEY}0`,
    '',
  ])('rejects key %p', (key) => {
    expect(isGuildCrestKey(key)).toBe(false);
    expect(() => crestFilePath(7, key, 'sm')).toThrow('invalid crest key');
    expect(() => crestPublicUrl(7, key, 'sm')).toThrow('invalid crest key');
  });
});

describe('hub-crest path guards and files', () => {
  it.each([0, -1, 1.5, Number.NaN])('rejects guild id %p', (id) => {
    expect(() => crestFilePath(id, KEY, 'sm')).toThrow('invalid guild id');
  });

  it('writes both files atomically (no temp left) and deletes them', async () => {
    await writeCrestFiles(7, KEY, {
      sm: Buffer.from('small'),
      lg: Buffer.from('large'),
    });
    expect(await readdir(path.join(root, '7'))).toEqual([
      `${KEY}.lg.webp`,
      `${KEY}.sm.webp`,
    ]);
    expect((await readFile(crestFilePath(7, KEY, 'sm'))).toString()).toBe(
      'small',
    );
    await deleteCrestFiles(7, KEY);
    expect(await readdir(path.join(root, '7'))).toEqual([]);
    await expect(deleteCrestFiles(7, KEY)).resolves.toBeUndefined();
  });

  it('refuses to write under an invalid key', async () => {
    await expect(
      writeCrestFiles(7, '../x', {
        sm: Buffer.from('a'),
        lg: Buffer.from('b'),
      }),
    ).rejects.toThrow('invalid crest key');
  });
});
