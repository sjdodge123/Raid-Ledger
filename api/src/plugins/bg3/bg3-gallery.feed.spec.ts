import type { CompanionBlobStore } from '../../companion/blobs/companion-blob.store';
import { Bg3GalleryFeed, toGalleryItems } from './bg3-gallery.feed';
import type { Bg3ReadRepository } from './read/bg3-read.repository';
import type { Bg3SavesReadRepository } from './read/bg3-saves.read.repository';
import { toMySave } from './read/bg3-my-saves.service';
import { pageSessions } from './read/bg3-read.mappers';

const at = new Date('2026-10-01T10:00:00.000Z');
const SHA = 'b'.repeat(64);
const row = (
  id: number,
  uploader: number,
  campaignId = 11,
  sha: string | null = SHA,
) => ({
  id,
  uploaderUserId: uploader,
  campaignKey: 'k',
  savedAt: at,
  campaignId,
  hostUserId: 2,
  area: 'WLD_Main_A',
  sha256: sha,
  displayName: null,
  username: `u${uploader}`,
});

describe('toGalleryItems (§5.7 + ROK-1959 §5.1)', () => {
  it('keeps the host twin, carries area + display name + provenance key', () => {
    expect(toGalleryItems([row(1, 7), row(2, 2)])).toEqual([
      {
        saveId: 2,
        uploaderUserId: 2,
        uploaderDisplayName: 'u2',
        sha256: SHA,
        savedAt: at,
        campaignId: 11,
        area: 'WLD_Main_A',
        provenanceKey: `k:${at.toISOString()}`,
      },
    ]);
  });

  it('dedupes per campaign and drops rows without a picture', () => {
    const items = toGalleryItems([
      row(1, 7, 11),
      row(2, 7, 12),
      row(3, 7, 13, null),
    ]);
    expect(items.map((i) => i.saveId)).toEqual([1, 2]);
  });
});

describe('Bg3GalleryFeed', () => {
  function feed(hidden: boolean) {
    const saves = {
      feedRows: jest.fn().mockResolvedValue([row(1, 7)]),
      saveInCampaign: jest.fn().mockResolvedValue({
        uploaderUserId: 7,
        guildId: 5,
        thumbnailSha256: SHA,
      }),
      bg3HubIds: jest.fn().mockResolvedValue([5]),
    };
    const read = {
      settings: jest.fn().mockResolvedValue({
        hideLocationAndScreenshots: hidden,
        activeCampaignId: null,
      }),
    };
    const blobs = { open: jest.fn().mockResolvedValue(null) };
    const f = new Bg3GalleryFeed(
      saves as unknown as Bg3SavesReadRepository,
      read as unknown as Bg3ReadRepository,
      blobs as unknown as CompanionBlobStore,
    );
    return { f, saves, blobs };
  }

  it('is empty while the hub hides spoilers (D-14)', async () => {
    const { f, saves, blobs } = feed(true);
    expect(await f.canonicalThumbnails(5)).toEqual([]);
    expect(saves.feedRows).not.toHaveBeenCalled();
    expect(await f.openRawThumbnail(1)).toBeNull();
    expect(blobs.open).not.toHaveBeenCalled();
  });

  it('lists canonical thumbnails and opens the raw blob of the uploader', async () => {
    const { f, blobs } = feed(false);
    expect((await f.canonicalThumbnails(5)).map((i) => i.saveId)).toEqual([1]);
    expect(await f.openRawThumbnail(1)).toBeNull();
    expect(blobs.open).toHaveBeenCalledWith(7, SHA);
    expect(await f.bg3HubIds()).toEqual([5]);
  });
});

describe('toMySave + pageSessions', () => {
  it('always shows the owner their own area + thumbnail', () => {
    const s = toMySave({
      id: 4,
      saveName: 'Q',
      savedAt: at,
      campaignKey: 'k',
      campaignKeySource: 'save-folder',
      campaignId: null,
      currentLevel: 'X',
      thumbnailSha256: SHA,
    });
    expect(s).toMatchObject({
      area: 'X',
      thumbnailUrl: '/plugins/bg3/me/saves/4/thumbnail',
    });
  });

  it('continues strictly after the cursor', () => {
    const mk = (id: number, h: number) => ({
      startedAt: new Date(h * 3600e3),
      endedAt: new Date(h * 3600e3),
      saveCount: 1,
      partyLevelFrom: 1,
      partyLevelTo: 1,
      areas: [],
      lastSaveId: id,
      rowIds: [id],
    });
    const all = [mk(1, 1), mk(2, 10), mk(3, 20)];
    const first = pageSessions(all, null, 2);
    expect(first.page.map((x) => x.lastSaveId)).toEqual([3, 2]);
    const second = pageSessions(all, first.next, 2);
    expect(second.page.map((x) => x.lastSaveId)).toEqual([1]);
    expect(second.next).toBeNull();
  });
});
