/**
 * ROK-1941 — the listener's guards (D4 own-bot only, DM / unbound channel)
 * and the partial-edit fetch, with ingest + resolver mocked.
 */
import { Test } from '@nestjs/testing';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { HubMediaChannelListener } from './hub-media-channel.listener';
import { HubMediaChannelResolver } from './hub-media-channel.queries';
import {
  HubMediaIngestPool,
  HubMediaIngestQueueFullError,
} from './hub-media-ingest.pool';
import { HubMediaPostIngest } from './hub-media-post.ingest';
import type { GatewayPost } from './hub-media-post.mapper';

const OWN = '600000000000000001';
const HUB = { guildId: 7, pelicanServerId: 3, gameSlug: 'valheim' };

const post = (over: Partial<GatewayPost> = {}): GatewayPost => ({
  id: '900',
  channelId: '800',
  guildId: '500',
  createdAt: new Date('2026-10-20T12:00:00Z'),
  content: 'Bjorn met their demise!',
  author: { id: '600000000000000002' },
  attachments: { values: () => [] },
  embeds: [],
  ...over,
});

describe('HubMediaChannelListener', () => {
  let listener: HubMediaChannelListener;
  const ingest = {
    ingestPost: jest.fn().mockResolvedValue(undefined),
    onEdit: jest.fn().mockResolvedValue(undefined),
    onDelete: jest.fn().mockResolvedValue(undefined),
  };
  const resolver = { resolve: jest.fn() };
  const client = { getClient: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    resolver.resolve.mockResolvedValue(HUB);
    client.getClient.mockReturnValue({ user: { id: OWN } });
    const mod = await Test.createTestingModule({
      providers: [
        HubMediaChannelListener,
        { provide: DiscordBotClientService, useValue: client },
        { provide: HubMediaChannelResolver, useValue: resolver },
        { provide: HubMediaPostIngest, useValue: ingest },
        {
          provide: HubMediaIngestPool,
          useValue: new HubMediaIngestPool({ limit: 2, queueMax: 1 }),
        },
      ],
    }).compile();
    listener = mod.get(HubMediaChannelListener);
  });

  it('ingests a webhook / other-bot post into the bound hub (D4)', async () => {
    await listener.onCreate(post());
    expect(ingest.ingestPost).toHaveBeenCalledWith(
      expect.objectContaining({ id: '900', authorId: '600000000000000002' }),
      HUB,
    );
  });

  it("skips the app's own post before resolving the channel (D4)", async () => {
    await listener.onCreate(post({ author: { id: OWN } }));
    expect(ingest.ingestPost).not.toHaveBeenCalled();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });

  it('ignores a DM and a channel no hub is bound to', async () => {
    await listener.onCreate(post({ guildId: null }));
    resolver.resolve.mockResolvedValueOnce(null);
    await listener.onCreate(post());
    expect(ingest.ingestPost).not.toHaveBeenCalled();
  });

  it('fetches a partial edit, then still skips it when it is our own', async () => {
    const fetch = jest.fn().mockResolvedValue(post({ author: { id: OWN } }));
    await listener.onUpdate({ ...post(), partial: true, fetch } as never);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(ingest.onEdit).not.toHaveBeenCalled();
  });

  it('a burst of creates never has more than the pool limit ingesting at once', async () => {
    let now = 0;
    let peak = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    ingest.ingestPost.mockImplementation(async () => {
      now += 1;
      peak = Math.max(peak, now);
      await held;
      now -= 1;
    });
    const burst = ['1', '2', '3', '4'].map((id) =>
      listener.onCreate(post({ id })).then(
        () => 'ingested',
        (err: unknown) =>
          err instanceof HubMediaIngestQueueFullError ? 'dropped' : 'thrown',
      ),
    );
    await new Promise<void>((r) => setImmediate(r));
    release();
    // limit 2 in flight + 1 queued; the 4th is dropped (bounded queue).
    expect(await Promise.all(burst)).toEqual([
      'ingested',
      'ingested',
      'ingested',
      'dropped',
    ]);
    expect(peak).toBe(2);
  });

  it('never drops an edit when the queue is full (edits are essential)', async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((r) => (release = r));
    ingest.onEdit.mockImplementation(async () => {
      await held;
    });
    const burst = ['1', '2', '3', '4'].map((id) =>
      listener.onUpdate(post({ id }) as never).then(
        () => 'edited',
        () => 'dropped',
      ),
    );
    await new Promise<void>((r) => setImmediate(r));
    release();
    expect(await Promise.all(burst)).toEqual([
      'edited',
      'edited',
      'edited',
      'edited',
    ]);
    expect(ingest.onEdit).toHaveBeenCalledTimes(4);
  });

  it('treats a bulk delete as one delete per message', async () => {
    const msgs = new Map([
      ['1', { ...post({ id: '1' }), partial: true }],
      ['2', { ...post({ id: '2' }), partial: true }],
    ]);
    await listener.onBulkDelete(msgs as never);
    expect(ingest.onDelete.mock.calls).toEqual([
      ['1', HUB],
      ['2', HUB],
    ]);
  });
});
