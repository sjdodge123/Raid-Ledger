/**
 * ROK-1942 — the hub media store against a real database + a tmpdir root:
 * dedupe (sequential + concurrent), the tombstone a re-run never re-adds,
 * the per-hub cap, refusals that leave nothing on disk, and the source kind.
 */
import { eq, sql } from 'drizzle-orm';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTestApp, type TestApp } from '../common/testing/test-app';
import { truncateAllTables } from '../common/testing/integration-helpers';
import { nonEmpty } from '../common/testing/narrow';
import * as schema from '../drizzle/schema';
import {
  HUB_MEDIA_DOWNLOADER,
  HubMediaDownloadError,
  type HubMediaDownloader,
} from './hub-media-download';
import { mediaFilePath } from './hub-media.paths';
import { HubMediaService } from './hub-media.service';
import { solidPng } from './hub-media.testing';
import type { HubMediaIngestInput } from './hub-media.types';

let testApp: TestApp;
let root: string;
let guildId: number;
let download: jest.SpyInstance;
const service = () => testApp.app.get(HubMediaService);

async function insertGuild(): Promise<number> {
  const [game] = nonEmpty(
    await testApp.db
      .insert(schema.games)
      .values({ name: 'HM Game', slug: 'hm-game' })
      .returning(),
    'game',
  );
  const [g] = nonEmpty(
    await testApp.db
      .insert(schema.guilds)
      .values({
        gameId: game.id,
        region: 'us',
        name: 'HM',
        nameKey: 'hm',
        source: 'addon_import',
      })
      .returning(),
    'guild',
  );
  return g.id;
}

const input = (
  key: string,
  over: Partial<HubMediaIngestInput> = {},
): HubMediaIngestInput => ({
  guildId,
  source: 'discord',
  kind: 'death',
  provenanceKey: key,
  sourceUrl: 'https://cdn.discordapp.com/attachments/1/2/shot.png',
  authorName: 'Ragnar',
  caption: 'fell off the cliff',
  capturedAt: new Date('2026-10-20T12:00:00Z'),
  discord: { channelId: '1', messageId: '2', attachmentId: key },
  ...over,
});

const rows = () =>
  testApp.db
    .select()
    .from(schema.hubMedia)
    .where(eq(schema.hubMedia.guildId, guildId));
const files = async (): Promise<string[]> => {
  const dir = join(root, String(guildId));
  return existsSync(dir) ? (await readdir(dir)).sort() : [];
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'hub-media-int-'));
  process.env.HUB_MEDIA_DIR = root;
  testApp = await getTestApp();
});

afterAll(() => {
  delete process.env.HUB_MEDIA_DIR;
});

beforeEach(async () => {
  guildId = await insertGuild();
  const png = await solidPng(1200, 800, 3);
  const downloader = testApp.app.get<HubMediaDownloader>(HUB_MEDIA_DOWNLOADER);
  download = jest.spyOn(downloader, 'download').mockResolvedValue(png);
});

afterEach(async () => {
  download.mockRestore();
  delete process.env.HUB_MEDIA_MAX_BYTES_PER_HUB;
  testApp.seed = await truncateAllTables(testApp.db);
});

describe('HubMediaService.ingest dedupe + tombstone (ROK-1942)', () => {
  it('stores one row with its kind and both renditions on disk', async () => {
    const res = await service().ingest(input('a', { kind: 'screenshot' }));
    expect(res.status).toBe('stored');
    const [row] = nonEmpty(await rows(), 'hub_media row');
    expect({
      kind: row.kind,
      w: row.width,
      h: row.height,
      removed: row.removedAt,
    }).toEqual({
      kind: 'screenshot',
      w: 1200,
      h: 800,
      removed: null,
    });
    expect(existsSync(mediaFilePath(guildId, row.storageName, 'full'))).toBe(
      true,
    );
    expect(existsSync(mediaFilePath(guildId, row.storageName, 'thumb'))).toBe(
      true,
    );
    expect(await files()).toEqual(
      [`${row.storageName}.thumb.webp`, `${row.storageName}.webp`].sort(),
    );
  });

  it('a second ingest of the same key is a duplicate with no second download', async () => {
    const first = await service().ingest(input('dup'));
    const second = await service().ingest(input('dup'));
    expect(second).toEqual({
      status: 'duplicate',
      mediaId: first.status === 'stored' ? first.mediaId : -1,
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect((await rows()).length).toBe(1);
    expect((await files()).length).toBe(2);
  });

  it('two concurrent ingests of one key leave one row and no orphan files', async () => {
    const results = await Promise.all([
      service().ingest(input('race')),
      service().ingest(input('race')),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([
      'duplicate',
      'stored',
    ]);
    expect((await rows()).length).toBe(1);
    expect((await files()).length).toBe(2);
  });

  it('removeByProvenance tombstones the row, unlinks the files, and a re-run never re-adds it', async () => {
    await service().ingest(input('gone'));
    expect(await service().removeByProvenance(guildId, 'gone')).toBe(true);
    const [row] = nonEmpty(await rows(), 'tombstone');
    expect(row.removedAt).toBeInstanceOf(Date);
    expect(await files()).toEqual([]);
    expect(await service().ingest(input('gone'))).toEqual({
      status: 'duplicate',
      mediaId: row.id,
    });
    expect(download).toHaveBeenCalledTimes(1);
    expect((await rows()).length).toBe(1);
    expect(await service().removeByProvenance(guildId, 'gone')).toBe(false);
  });
});

describe('HubMediaService.ingest refusals (ROK-1942)', () => {
  it('refuses a hub at its byte cap with nothing on disk', async () => {
    await service().ingest(input('first'));
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = '1';
    expect(await service().ingest(input('second'))).toEqual({
      status: 'rejected',
      reason: 'cap',
    });
    expect((await rows()).length).toBe(1);
    expect((await files()).length).toBe(2);
  });

  it('refuses a picture that would push the hub past its cap', async () => {
    process.env.HUB_MEDIA_MAX_BYTES_PER_HUB = '100';
    expect(await service().ingest(input('big'))).toEqual({
      status: 'rejected',
      reason: 'cap',
    });
    expect(await rows()).toEqual([]);
    expect(await files()).toEqual([]);
  });

  it('refuses a non-Discord host, non-image bytes and an oversized download', async () => {
    const host = await service().ingest(
      input('h', { sourceUrl: 'https://evil.example/x.png' }),
    );
    download.mockResolvedValueOnce(Buffer.from('not a picture'));
    const text = await service().ingest(input('t'));
    download.mockRejectedValueOnce(new HubMediaDownloadError('too_large'));
    const big = await service().ingest(input('b'));
    expect([host, text, big]).toEqual([
      { status: 'rejected', reason: 'host' },
      { status: 'rejected', reason: 'not_image' },
      { status: 'rejected', reason: 'too_large' },
    ]);
    expect(await rows()).toEqual([]);
    expect(await files()).toEqual([]);
  });

  it('the kind CHECK refuses an unknown kind', async () => {
    await expect(
      testApp.db.insert(schema.hubMedia).values({
        guildId,
        source: 'discord',
        // Raw SQL: the column is typed HubMediaKind, the CHECK is what's under test.
        kind: sql`'video'`,
        provenanceKey: 'k',
        capturedAt: new Date(),
        storageName: 'x',
        width: 1,
        height: 1,
        bytes: 1,
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: 'hub_media_kind_check' },
    });
  });
});
