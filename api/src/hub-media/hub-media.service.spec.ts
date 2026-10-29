/**
 * ROK-1965 — `HubMediaService.ingestUpload`: the provenance gate (D5) and
 * the row it hands the shared store tail. Repository + store tail mocked.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import type { HubMediaDownloader } from './hub-media-download';
import { unlinkMediaFiles } from './hub-media.files';
import {
  bytesUsed,
  findByKey,
  liveRowsBySourceAndUploader,
  markRemoved,
} from './hub-media.repository';
import { encodeAndStore } from './hub-media-store.helpers';
import { HubMediaService } from './hub-media.service';
import {
  uploadProvenanceKey,
  type HubMediaSourceInput,
} from './hub-media.types';

jest.mock('./hub-media.repository', () => ({
  bytesUsed: jest.fn(),
  findByKey: jest.fn(),
  markRemoved: jest.fn(),
  liveRowsBySourceAndUploader: jest.fn(),
}));
jest.mock('./hub-media.files', () => ({ unlinkMediaFiles: jest.fn() }));
jest.mock('./hub-media-store.helpers', () => ({
  ...jest.requireActual<object>('./hub-media-store.helpers'),
  encodeAndStore: jest.fn(),
}));

const db = {} as PostgresJsDatabase<typeof schema>;
const downloader: HubMediaDownloader = { download: jest.fn() };
const bytes = Buffer.from('png-bytes');
const input = {
  guildId: 7,
  uploaderId: 42,
  authorName: 'Ada',
  caption: null,
  bytes,
};

describe('HubMediaService.ingestUpload', () => {
  const service = new HubMediaService(db, downloader);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(bytesUsed).mockResolvedValue(0);
  });

  it('refuses bytes that were removed from this hub', async () => {
    jest
      .mocked(findByKey)
      .mockResolvedValue({ id: 3, removedAt: new Date('2026-10-01') });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'rejected',
      reason: 'removed',
    });
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('returns the live row for a double-submit', async () => {
    jest.mocked(findByKey).mockResolvedValue({ id: 3, removedAt: null });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'duplicate',
      mediaId: 3,
    });
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('stores an upload row keyed by the bytes and owned by the uploader', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest
      .mocked(encodeAndStore)
      .mockResolvedValue({ status: 'stored', mediaId: 9 });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'stored',
      mediaId: 9,
    });
    expect(jest.mocked(encodeAndStore).mock.calls[0]?.[1]).toMatchObject({
      source: 'upload',
      kind: 'upload',
      provenanceKey: uploadProvenanceKey(bytes),
      uploadedBy: 42,
      discord: null,
    });
  });

  it('maps a store-tail cap to a cap rejection', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest.mocked(encodeAndStore).mockResolvedValue({ status: 'cap' });
    expect(await service.ingestUpload(input)).toEqual({
      status: 'rejected',
      reason: 'cap',
    });
  });
});

const saveInput: HubMediaSourceInput = {
  guildId: 7,
  source: 'bg3-save',
  kind: 'save',
  provenanceKey: 'bg3-save:sha256:abc',
  uploadedBy: 42,
  authorName: 'Ada',
  caption: 'Act 1',
  capturedAt: new Date('2026-10-20T20:00:00Z'),
  bytes,
};

describe('HubMediaService.ingestFromSource (ROK-1959)', () => {
  const service = new HubMediaService(db, downloader);

  beforeEach(() => {
    jest.resetAllMocks();
    jest.mocked(bytesUsed).mockResolvedValue(0);
  });

  it.each([
    ['a live row', null],
    ['a tombstone (removed picture is never re-added)', new Date('2026-10-21')],
  ])('answers duplicate for %s without encoding', async (_l, removedAt) => {
    jest.mocked(findByKey).mockResolvedValue({ id: 5, removedAt });
    expect(await service.ingestFromSource(saveInput)).toEqual({
      status: 'duplicate',
      mediaId: 5,
    });
    expect(bytesUsed).not.toHaveBeenCalled();
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('refuses with cap before encoding when the hub is full', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest.mocked(bytesUsed).mockResolvedValue(Number.MAX_SAFE_INTEGER);
    expect(await service.ingestFromSource(saveInput)).toEqual({
      status: 'rejected',
      reason: 'cap',
    });
    expect(encodeAndStore).not.toHaveBeenCalled();
  });

  it('stores the source row as given, with no Discord ids and the bytes passed through', async () => {
    jest.mocked(findByKey).mockResolvedValue(undefined);
    jest
      .mocked(encodeAndStore)
      .mockResolvedValue({ status: 'stored', mediaId: 11 });
    expect(await service.ingestFromSource(saveInput)).toEqual({
      status: 'stored',
      mediaId: 11,
    });
    const [, row, raw] = jest.mocked(encodeAndStore).mock.calls[0] ?? [];
    expect(row).toEqual({
      guildId: 7,
      source: 'bg3-save',
      kind: 'save',
      provenanceKey: 'bg3-save:sha256:abc',
      uploadedBy: 42,
      authorName: 'Ada',
      caption: 'Act 1',
      capturedAt: saveInput.capturedAt,
      discord: null,
    });
    expect(raw).toBe(bytes);
  });
});

describe('HubMediaService.removeSourceRowsOf (ROK-1959 D-9)', () => {
  const service = new HubMediaService(db, downloader);

  beforeEach(() => jest.resetAllMocks());

  it('tombstones and unlinks each live row of the member, skipping one removed meanwhile', async () => {
    jest.mocked(liveRowsBySourceAndUploader).mockResolvedValue([
      { id: 1, guildId: 7 },
      { id: 2, guildId: 8 },
      { id: 3, guildId: 8 },
    ]);
    jest
      .mocked(markRemoved)
      .mockResolvedValueOnce('a.webp')
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('c.webp');
    expect(await service.removeSourceRowsOf('bg3-save', 42)).toBe(2);
    expect(liveRowsBySourceAndUploader).toHaveBeenCalledWith(
      db,
      'bg3-save',
      42,
    );
    expect(jest.mocked(markRemoved).mock.calls.map((c) => c[1])).toEqual([
      { guildId: 7, id: 1 },
      { guildId: 8, id: 2 },
      { guildId: 8, id: 3 },
    ]);
    expect(jest.mocked(unlinkMediaFiles).mock.calls).toEqual([
      [7, 'a.webp'],
      [8, 'c.webp'],
    ]);
  });

  it('removes nothing when the member has no rows from the source', async () => {
    jest.mocked(liveRowsBySourceAndUploader).mockResolvedValue([]);
    expect(await service.removeSourceRowsOf('bg3-save', 42)).toBe(0);
    expect(markRemoved).not.toHaveBeenCalled();
  });
});
