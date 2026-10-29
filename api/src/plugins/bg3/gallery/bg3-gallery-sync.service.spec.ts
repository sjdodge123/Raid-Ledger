import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../../drizzle/schema';
import type { HubMediaIngestPool } from '../../../hub-media/hub-media-ingest.pool';
import * as repo from '../../../hub-media/hub-media.repository';
import type { HubMediaService } from '../../../hub-media/hub-media.service';
import type { HubMediaIngestResult } from '../../../hub-media/hub-media.types';
import type { Bg3GalleryFeed, Bg3GalleryItem } from '../bg3-gallery.feed';
import { Bg3GallerySyncService } from './bg3-gallery-sync.service';

const H = 3_600_000;
const NOW = new Date(Date.UTC(2026, 9, 20, 12));

/** Three closed sessions (one save each) on hub 5. */
const ITEMS: Bg3GalleryItem[] = [30, 20, 10].map((hoursAgo, n) => ({
  saveId: n + 1,
  uploaderUserId: 7,
  uploaderDisplayName: 'Ada',
  sha256: `sha${n + 1}`,
  savedAt: new Date(NOW.getTime() - hoursAgo * H),
  campaignId: 1,
  area: 'Grove',
  provenanceKey: `k${n}`,
}));

function setup(results: HubMediaIngestResult[], blobs: (Buffer | null)[]) {
  const feed = {
    bg3HubIds: jest.fn().mockResolvedValue([5]),
    canonicalThumbnails: jest.fn().mockResolvedValue(ITEMS),
    openRawThumbnail: jest.fn(),
  };
  for (const b of blobs) feed.openRawThumbnail.mockResolvedValueOnce(b);
  const hubMedia = { ingestFromSource: jest.fn() };
  for (const r of results) hubMedia.ingestFromSource.mockResolvedValueOnce(r);
  const pool = {
    run: jest.fn((_label: string, work: () => Promise<unknown>) => work()),
  };
  const svc = new Bg3GallerySyncService(
    {} as PostgresJsDatabase<typeof schema>,
    feed as unknown as Bg3GalleryFeed,
    hubMedia as unknown as HubMediaService,
    pool as unknown as HubMediaIngestPool,
  );
  return { svc, feed, hubMedia, pool };
}

const PNG = Buffer.from('png');

describe('Bg3GallerySyncService.runOnce (ROK-1959 D-3 / D-11)', () => {
  beforeEach(() => {
    jest.spyOn(repo, 'existingKeys').mockResolvedValue(new Set());
  });
  afterEach(() => jest.restoreAllMocks());

  it('copies each pick through the ingest pool with the D-8 row fields', async () => {
    const { svc, hubMedia, pool } = setup(
      [1, 2, 3].map((mediaId) => ({ status: 'stored', mediaId })),
      [PNG, PNG, PNG],
    );
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 3,
      skipped: 0,
      failedHubs: 0,
    });
    expect(pool.run).toHaveBeenCalledTimes(3);
    expect(hubMedia.ingestFromSource).toHaveBeenNthCalledWith(1, {
      guildId: 5,
      source: 'bg3-save',
      kind: 'save',
      provenanceKey: 'bg3-save:sha256:sha1',
      uploadedBy: 7,
      authorName: 'Ada',
      caption: 'Grove',
      capturedAt: ITEMS[0]?.savedAt,
      bytes: PNG,
    });
  });

  it('a missing blob is skipped with no row, the rest still copied', async () => {
    const { svc, hubMedia } = setup(
      [
        { status: 'stored', mediaId: 2 },
        { status: 'stored', mediaId: 3 },
      ],
      [null, PNG, PNG],
    );
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 2,
      skipped: 1,
      failedHubs: 0,
    });
    expect(hubMedia.ingestFromSource).toHaveBeenCalledTimes(2);
  });

  it('a not-an-image rejection is skipped (retried next run)', async () => {
    const { svc } = setup(
      [
        { status: 'rejected', reason: 'not_image' },
        { status: 'stored', mediaId: 2 },
        { status: 'stored', mediaId: 3 },
      ],
      [PNG, PNG, PNG],
    );
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 2,
      skipped: 1,
      failedHubs: 0,
    });
  });

  it('stops the hub for this run once the cap is reached', async () => {
    const { svc, hubMedia } = setup(
      [
        { status: 'stored', mediaId: 1 },
        { status: 'rejected', reason: 'cap' },
      ],
      [PNG, PNG, PNG],
    );
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 1,
      skipped: 0,
      failedHubs: 0,
    });
    expect(hubMedia.ingestFromSource).toHaveBeenCalledTimes(2);
  });

  it('asks existing keys for every feed sha and reads the feed over the retention window', async () => {
    const { svc, feed } = setup([], []);
    jest
      .spyOn(repo, 'existingKeys')
      .mockResolvedValue(
        new Set(ITEMS.map((i) => `bg3-save:sha256:${i.sha256}`)),
      );
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 0,
      skipped: 0,
      failedHubs: 0,
    });
    expect(feed.canonicalThumbnails).toHaveBeenCalledWith(
      5,
      new Date(NOW.getTime() - 90 * 24 * H),
    );
    expect(feed.openRawThumbnail).not.toHaveBeenCalled();
  });

  it('a hub that throws is counted and does not throw the run', async () => {
    const { svc, feed } = setup([], []);
    feed.canonicalThumbnails.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.runOnce(NOW)).resolves.toEqual({
      stored: 0,
      skipped: 0,
      failedHubs: 1,
    });
  });
});
