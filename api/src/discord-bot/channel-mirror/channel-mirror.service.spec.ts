/**
 * ROK-1788 — ChannelMirrorService: the cache sits in front of Discord, the
 * bot-down path is uncached, and failures are cached (D1/D5).
 */
import type { DiscordBotClientService } from '../discord-bot-client.service';
import { ChannelMirrorService } from './channel-mirror.service';
import { toMirrorPort } from './channel-mirror.discord';
import type { MirrorChannelPort } from './channel-mirror.read';
import { sourceMessage } from './channel-mirror.spec-helpers';
import { CHANNEL_MIRROR_REFRESH_MIN_MS } from './channel-mirror.helpers';

jest.mock('./channel-mirror.discord', () => ({
  toMirrorPort: jest.fn(),
  findTextChannel: jest.fn(),
  canMemberView: jest.fn(),
  listReadableChannels: jest.fn(),
}));

const toMirrorPortMock = jest.mocked(toMirrorPort);

function makeService(guild: { id: string } | null): ChannelMirrorService {
  const client = {
    getGuild: () => guild,
    getGuildId: () => guild?.id ?? null,
  };
  return new ChannelMirrorService(client as unknown as DiscordBotClientService);
}

function portWith(
  fetchLatest: MirrorChannelPort['fetchLatest'],
): MirrorChannelPort {
  return {
    id: '555',
    name: 'general',
    botCanRead: () => true,
    isPrivate: () => false,
    fetchLatest,
  };
}

describe('ChannelMirrorService.readLatest', () => {
  beforeEach(() => toMirrorPortMock.mockReset());

  it('is disconnected, without touching Discord, when the bot is down', async () => {
    const service = makeService(null);
    await expect(service.readLatest('555')).resolves.toEqual({
      state: 'disconnected',
      channelId: '555',
    });
    expect(toMirrorPortMock).not.toHaveBeenCalled();
  });

  it('two concurrent page loads cause ONE Discord fetch', async () => {
    const fetchLatest = jest.fn().mockResolvedValue([sourceMessage()]);
    toMirrorPortMock.mockReturnValue(portWith(fetchLatest));
    const service = makeService({ id: 'G1' });
    const [a, b] = await Promise.all([
      service.readLatest('555'),
      service.readLatest('555'),
    ]);
    expect(a.state).toBe('ok');
    expect(b).toBe(a);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('caches a failed read, so a broken binding does not hammer Discord', async () => {
    const fetchLatest = jest.fn().mockRejectedValue(new Error('down'));
    toMirrorPortMock.mockReturnValue(portWith(fetchLatest));
    const service = makeService({ id: 'G1' });
    await service.readLatest('555');
    await service.readLatest('555');
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('clear() makes the next read go back to Discord', async () => {
    const fetchLatest = jest.fn().mockResolvedValue([]);
    toMirrorPortMock.mockReturnValue(portWith(fetchLatest));
    const service = makeService({ id: 'G1' });
    await service.readLatest('555');
    service.clear('555');
    await service.readLatest('555');
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });
});

describe('ChannelMirrorService.readLatest refresh (ROK-2185)', () => {
  beforeEach(() => {
    toMirrorPortMock.mockReset();
    jest.useFakeTimers({ now: 1_000_000 });
  });
  afterEach(() => jest.useRealTimers());

  function serviceWithFetch(): {
    service: ChannelMirrorService;
    fetchLatest: jest.Mock;
  } {
    const fetchLatest = jest.fn().mockResolvedValue([]);
    toMirrorPortMock.mockReturnValue(portWith(fetchLatest));
    return { service: makeService({ id: 'G1' }), fetchLatest };
  }

  it('skips the 60s cache once the cached read is 15s old', async () => {
    const { service, fetchLatest } = serviceWithFetch();
    await service.readLatest('555');
    jest.setSystemTime(1_000_000 + CHANNEL_MIRROR_REFRESH_MIN_MS);
    await service.readLatest('555', { refresh: true });
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  it('serves the cache for a refresh inside the 15s floor', async () => {
    const { service, fetchLatest } = serviceWithFetch();
    await service.readLatest('555');
    jest.setSystemTime(1_000_000 + CHANNEL_MIRROR_REFRESH_MIN_MS - 1);
    await service.readLatest('555', { refresh: true });
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('a plain read 15s later still serves the cache', async () => {
    const { service, fetchLatest } = serviceWithFetch();
    await service.readLatest('555');
    jest.setSystemTime(1_000_000 + CHANNEL_MIRROR_REFRESH_MIN_MS);
    await service.readLatest('555');
    expect(fetchLatest).toHaveBeenCalledTimes(1);
  });

  it('the floor is 15 seconds', () => {
    expect(CHANNEL_MIRROR_REFRESH_MIN_MS).toBe(15_000);
  });
});

describe('ChannelMirrorService bot-down fallbacks', () => {
  it('lists no channels and reports disconnected', () => {
    expect(makeService(null).listReadableTextChannels()).toEqual({
      connected: false,
      channels: [],
    });
  });

  it('refuses the chooser check and has no url', async () => {
    const service = makeService(null);
    await expect(service.canDiscordUserView('42', '555')).resolves.toBe(false);
    expect(service.channelUrl('555')).toBeNull();
  });

  it('builds the url from the connected server id', () => {
    expect(makeService({ id: 'G1' }).channelUrl('555')).toBe(
      'https://discord.com/channels/G1/555',
    );
  });
});
