/**
 * Unit tests for DiscordChannelsController (ROK-1064).
 *
 * Covers:
 *   - Throws 503 when bot is not connected.
 *   - Returns all text channels when `permissions` is omitted.
 *   - Filters by bot post permissions when `permissions=postable`.
 *   - Skips threads + non-text + DM-based channels.
 *   - Sorts alphabetically by name.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { DiscordChannelsController } from './discord-channels.controller';
import { DiscordBotClientService } from './discord-bot-client.service';

interface FakeChannelOpts {
  id: string;
  name: string;
  hasPerms?: boolean;
  isThread?: boolean;
  isDM?: boolean;
  isText?: boolean;
}

function fakeChannel(opts: FakeChannelOpts) {
  return {
    id: opts.id,
    name: opts.name,
    isTextBased: () => opts.isText !== false,
    isThread: () => opts.isThread === true,
    isDMBased: () => opts.isDM === true,
    permissionsFor: () => ({ has: () => opts.hasPerms === true }),
  };
}

function fakeGuild(channels: FakeChannelOpts[]) {
  const built = channels.map(fakeChannel);
  return {
    members: { me: { id: 'bot-1' } },
    channels: {
      cache: { forEach: (fn: (c: unknown) => void) => built.forEach(fn) },
    },
  };
}

let controller: DiscordChannelsController;
let clientService: jest.Mocked<DiscordBotClientService>;

async function buildModule(): Promise<TestingModule> {
  return Test.createTestingModule({
    controllers: [DiscordChannelsController],
    providers: [
      {
        provide: DiscordBotClientService,
        useValue: { getGuild: jest.fn().mockReturnValue(null) },
      },
    ],
  }).compile();
}

beforeEach(async () => {
  const module = await buildModule();
  controller = module.get(DiscordChannelsController);
  clientService = module.get(DiscordBotClientService);
});

describe('DiscordChannelsController — listChannels', () => {
  it('throws 503 when bot is not connected', () => {
    clientService.getGuild.mockReturnValue(null);
    expect(() => controller.listChannels('postable')).toThrow(
      ServiceUnavailableException,
    );
  });

  it('returns all text channels when permissions is omitted', () => {
    clientService.getGuild.mockReturnValue(
      fakeGuild([
        { id: '1', name: 'general', hasPerms: true },
        { id: '2', name: 'random', hasPerms: false },
      ]) as unknown as ReturnType<DiscordBotClientService['getGuild']>,
    );
    const result = controller.listChannels();
    expect(result.data).toEqual([
      { id: '1', name: 'general' },
      { id: '2', name: 'random' },
    ]);
  });

  it('filters to postable channels when permissions=postable', () => {
    clientService.getGuild.mockReturnValue(
      fakeGuild([
        { id: '1', name: 'general', hasPerms: true },
        { id: '2', name: 'no-perms', hasPerms: false },
        { id: '3', name: 'events', hasPerms: true },
      ]) as unknown as ReturnType<DiscordBotClientService['getGuild']>,
    );
    const result = controller.listChannels('postable');
    expect(result.data.map((c) => c.id)).toEqual(['3', '1']);
  });

  it('excludes threads and non-text channels', () => {
    clientService.getGuild.mockReturnValue(
      fakeGuild([
        { id: '1', name: 'text', hasPerms: true },
        { id: '2', name: 'thread', hasPerms: true, isThread: true },
        { id: '3', name: 'voice', hasPerms: true, isText: false },
        { id: '4', name: 'dm', hasPerms: true, isDM: true },
      ]) as unknown as ReturnType<DiscordBotClientService['getGuild']>,
    );
    const result = controller.listChannels('postable');
    expect(result.data.map((c) => c.id)).toEqual(['1']);
  });

  it('sorts channels alphabetically by name', () => {
    clientService.getGuild.mockReturnValue(
      fakeGuild([
        { id: '1', name: 'zebra', hasPerms: true },
        { id: '2', name: 'alpha', hasPerms: true },
        { id: '3', name: 'mike', hasPerms: true },
      ]) as unknown as ReturnType<DiscordBotClientService['getGuild']>,
    );
    const result = controller.listChannels('postable');
    expect(result.data.map((c) => c.name)).toEqual(['alpha', 'mike', 'zebra']);
  });

  it('returns empty postable list when guild.members.me is absent', () => {
    clientService.getGuild.mockReturnValue({
      members: {},
      channels: {
        cache: {
          forEach: (fn: (c: unknown) => void) =>
            fn(fakeChannel({ id: '1', name: 'general', hasPerms: true })),
        },
      },
    } as unknown as ReturnType<DiscordBotClientService['getGuild']>);
    const result = controller.listChannels('postable');
    expect(result.data).toEqual([]);
  });
});
