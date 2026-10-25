/**
 * ROK-1941 — `HubMediaPostIngest` unit rules the integration spec cannot
 * isolate: an edit that drops pictures tells the classifiers (D11, as a
 * delete does), and a tombstoned duplicate is never handed to `afterStore`.
 */
import type { HubMediaHubRef } from '../../hub-media/hub-media-classifier.registry';
import { discordProvenanceKey } from '../../hub-media/hub-media.types';
import { findMessageMedia } from './hub-media-channel.queries';
import type { PostLike } from './hub-media-post.images';
import { HubMediaPostIngest } from './hub-media-post.ingest';

jest.mock('./hub-media-channel.queries', () => ({
  findMessageMedia: jest.fn(),
}));

const HUB: HubMediaHubRef = { guildId: 3, pelicanServerId: 9, gameSlug: 'x' };
const found = jest.mocked(findMessageMedia);
const media = { ingest: jest.fn(), removeByProvenance: jest.fn() };
const classifier = {
  classify: jest.fn(),
  afterStore: jest.fn(),
  afterRemove: jest.fn(),
};
const registry = { classify: jest.fn(), afterRemove: jest.fn() };
const OWN_BOT_ID = 'own-bot';
const clientService = { getClient: jest.fn() };
const CLASSIFICATION = { kind: 'death', authorName: 'Bjorn', caption: null };

function post(attachmentIds: string[]): PostLike {
  return {
    id: 'm1',
    channelId: 'c1',
    createdAt: new Date('2026-10-20T12:00:00Z'),
    authorId: 'a1',
    content: 'Bjorn met their demise!',
    embeds: [],
    attachments: attachmentIds.map((id) => ({
      id,
      url: `https://cdn.discordapp.com/attachments/c1/m1/${id}.png`,
      contentType: 'image/png',
      name: `${id}.png`,
    })),
  };
}

const key = (attachmentId: string) =>
  discordProvenanceKey({ channelId: 'c1', messageId: 'm1', attachmentId });
const row = (id: number, attachmentId: string) => ({
  id,
  provenanceKey: key(attachmentId),
  kind: 'death',
});

function makeIngest(): HubMediaPostIngest {
  return new HubMediaPostIngest(
    {} as never,
    media as never,
    registry as never,
    clientService as never,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  registry.classify.mockReturnValue({
    classification: CLASSIFICATION,
    classifier,
  });
  media.removeByProvenance.mockResolvedValue(true);
  classifier.afterStore.mockResolvedValue('linked');
  clientService.getClient.mockReturnValue({ user: { id: OWN_BOT_ID } });
});

describe('HubMediaPostIngest.onEdit (D11)', () => {
  it('tells the classifiers which pictures the edit dropped', async () => {
    found.mockResolvedValue([row(1, 'a'), row(2, 'b')]);
    media.ingest.mockResolvedValue({ status: 'duplicate', mediaId: 2 });
    await makeIngest().onEdit(post(['b']), HUB);
    expect(media.removeByProvenance.mock.calls).toEqual([[3, key('a')]]);
    expect(registry.afterRemove.mock.calls).toEqual([[HUB, [1]]]);
  });

  it('removes nothing when the edit keeps every picture', async () => {
    found.mockResolvedValue([row(1, 'a')]);
    media.ingest.mockResolvedValue({ status: 'duplicate', mediaId: 1 });
    await makeIngest().onEdit(post(['a']), HUB);
    expect(media.removeByProvenance).not.toHaveBeenCalled();
    expect(registry.afterRemove).not.toHaveBeenCalled();
    expect(classifier.afterStore).not.toHaveBeenCalled();
  });

  it('re-links the new first picture when the edit swapped the first one', async () => {
    found.mockResolvedValue([row(1, 'a'), row(2, 'b')]);
    media.ingest
      .mockResolvedValueOnce({ status: 'stored', mediaId: 3 })
      .mockResolvedValueOnce({ status: 'duplicate', mediaId: 2 });
    await makeIngest().onEdit(post(['c', 'b']), HUB);
    expect(registry.afterRemove.mock.calls).toEqual([[HUB, [1]]]);
    expect(classifier.afterStore.mock.calls).toEqual([
      [expect.objectContaining({ mediaId: 3, index: 0, filename: 'c.png' })],
    ]);
  });
});

describe('HubMediaPostIngest.ingestPost — tombstoned duplicates', () => {
  it('never links a death to a removed picture', async () => {
    found.mockResolvedValue([]); // id 7 exists only as a tombstone
    media.ingest.mockResolvedValue({ status: 'duplicate', mediaId: 7 });
    const summary = await makeIngest().ingestPost(post(['a']), HUB);
    expect(classifier.afterStore).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ duplicates: 1, deathsLinked: 0 });
  });

  it('still repairs the link of a live duplicate', async () => {
    found.mockResolvedValue([row(7, 'a')]);
    media.ingest.mockResolvedValue({ status: 'duplicate', mediaId: 7 });
    const summary = await makeIngest().ingestPost(post(['a']), HUB);
    expect(classifier.afterStore.mock.calls).toEqual([
      [expect.objectContaining({ mediaId: 7, index: 0 })],
    ]);
    expect(summary).toMatchObject({ duplicates: 1, deathsLinked: 1 });
  });
});

describe("HubMediaPostIngest.ingestPost — the app's own posts (D4)", () => {
  it("stores nothing from the bot's own post (live + backfill share this)", async () => {
    found.mockResolvedValue([]);
    media.ingest.mockResolvedValue({ status: 'stored', mediaId: 1 });
    const own = { ...post(['a']), authorId: OWN_BOT_ID };
    const summary = await makeIngest().ingestPost(own, HUB);
    expect(media.ingest).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ images: 0, stored: 0 });
  });

  it('still stores a webhook post while the bot is offline', async () => {
    clientService.getClient.mockReturnValue(null);
    found.mockResolvedValue([]);
    media.ingest.mockResolvedValue({ status: 'stored', mediaId: 1 });
    const summary = await makeIngest().ingestPost(post(['a']), HUB);
    expect(summary).toMatchObject({ images: 1, stored: 1 });
  });
});
