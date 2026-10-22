/**
 * ROK-1872 (ROK-1428 §2.8): every card refresh path keeps the event's Hub
 * button — running-late / roach-out re-renders, the signup listener and the
 * event listener resolve the hub link exactly like the poster does.
 */
import { Logger, type InjectionToken } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { resolveEventHubLink } from '../channel-lifecycle/embed-hub-link.helpers';
import {
  updateChannelEmbeds as lateRefresh,
  type RunningLateDeps,
} from './running-late-interaction.handlers';
import {
  updateChannelEmbeds as roachRefresh,
  type RoachOutDeps,
} from './roach-out-interaction.handlers';
import { DiscordEventListener } from './event.listener';
import { SignupInteractionListener } from './signup-interaction.listener';
import { createSignupInteractionTestModule } from './signup-interaction.spec-helpers';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import { DiscordEmbedFactory } from '../services/discord-embed.factory';
import { EmbedPosterService } from '../services/embed-poster.service';
import { ChannelResolverService } from '../services/channel-resolver.service';
import { SettingsService } from '../../settings/settings.service';
import { ScheduledEventService } from '../services/scheduled-event.service';
import { EventLifecycleQueueService } from '../queues/event-lifecycle.queue';

jest.mock('../channel-lifecycle/embed-hub-link.helpers', () => ({
  ...jest.requireActual<object>('../channel-lifecycle/embed-hub-link.helpers'),
  resolveEventHubLink: jest.fn(),
}));

const BASE = 'https://raid.example.com';
const HUB = { url: `${BASE}/guilds/7`, label: 'Hub' as const };
const resolve = jest.mocked(resolveEventHubLink);
const RECORD = { channelId: 'c1', messageId: 'm1', embedState: 'posted' };

const settings = {
  getBranding: jest.fn().mockResolvedValue({ communityName: 'G' }),
  getClientUrl: jest.fn().mockResolvedValue(BASE),
  getDefaultTimezone: jest.fn().mockResolvedValue('UTC'),
};

/** Partial handler deps: one embed record, a spy factory. */
function handlerDeps(): { deps: unknown; build: jest.Mock } {
  const build = jest.fn().mockReturnValue({ embed: {}, row: {} });
  const where = jest.fn().mockResolvedValue([RECORD]);
  const deps = {
    db: { select: () => ({ from: () => ({ where }) }) },
    clientService: { getGuildId: () => 'g1', editEmbed: jest.fn() },
    eventsService: { buildEmbedEventData: jest.fn().mockResolvedValue({}) },
    embedFactory: { buildEventEmbed: build },
    settingsService: settings,
    logger: new Logger('spec'),
  };
  return { deps, build };
}

/** Empty `useValue` providers for tokens a test never touches. */
function stubs(
  tokens: InjectionToken[],
): Array<{ provide: InjectionToken; useValue: object }> {
  return tokens.map((provide) => ({ provide, useValue: {} }));
}

function ctxOf(build: jest.Mock): unknown {
  return build.mock.calls[0]?.[1];
}

describe('card refresh paths keep the hub link (ROK-1872)', () => {
  const prevUrl = process.env.CLIENT_URL;
  beforeAll(() => (process.env.CLIENT_URL = BASE));
  afterAll(() => (process.env.CLIENT_URL = prevUrl));
  beforeEach(() => resolve.mockReset().mockResolvedValue(HUB));

  it('running-late re-render carries the Hub link', async () => {
    const { deps, build } = handlerDeps();
    await lateRefresh(deps as RunningLateDeps, 42);
    expect(ctxOf(build)).toMatchObject({ clientUrl: BASE, hubLink: HUB });
    expect(resolve).toHaveBeenCalledWith(
      expect.anything(),
      42,
      BASE,
      expect.anything(),
    );
  });

  it('roach-out re-render carries the Hub link', async () => {
    const { deps, build } = handlerDeps();
    await roachRefresh(deps as RoachOutDeps, 42);
    expect(ctxOf(build)).toMatchObject({ clientUrl: BASE, hubLink: HUB });
  });

  it('signup listener context carries the Hub link', async () => {
    const { module } = await createSignupInteractionTestModule();
    const listener = module.get(SignupInteractionListener);
    const ctx = await listener['buildEmbedContext'](42);
    expect(ctx).toMatchObject({ clientUrl: BASE, hubLink: HUB });
  });

  it('event listener refresh context carries the Hub link', async () => {
    const module = await Test.createTestingModule({
      providers: [
        DiscordEventListener,
        ...stubs([DrizzleAsyncProvider, DiscordBotClientService]),
        ...stubs([DiscordEmbedFactory, EmbedPosterService]),
        ...stubs([ChannelResolverService, ScheduledEventService]),
        ...stubs([EventLifecycleQueueService]),
        { provide: SettingsService, useValue: settings },
      ],
    }).compile();
    const listener = module.get(DiscordEventListener);
    expect(await listener['buildContext'](42)).toEqual({
      communityName: 'G',
      clientUrl: BASE,
      timezone: 'UTC',
      hubLink: HUB,
    });
    expect('hubLink' in (await listener['buildContext']())).toBe(false);
  });
});

// ROK-1428 Codex r6 P2: the poster and embed-sync resolve the client URL via
// `SettingsService.getClientUrl()`; a refresh built from `process.env` swapped
// a working Hub link for a stale one when the two differ.
describe('card refresh paths use the settings-backed client URL', () => {
  const STALE = 'https://stale-env.example';
  const prevUrl = process.env.CLIENT_URL;
  beforeAll(() => (process.env.CLIENT_URL = STALE));
  afterAll(() => (process.env.CLIENT_URL = prevUrl));
  beforeEach(() => resolve.mockReset().mockResolvedValue(HUB));

  it('running-late re-render resolves the hub against settings, not env', async () => {
    const { deps, build } = handlerDeps();
    await lateRefresh(deps as RunningLateDeps, 42);
    expect(ctxOf(build)).toMatchObject({ clientUrl: BASE });
    expect(resolve).toHaveBeenCalledWith(
      expect.anything(),
      42,
      BASE,
      expect.anything(),
    );
  });

  it('roach-out re-render uses the settings client URL', async () => {
    const { deps, build } = handlerDeps();
    await roachRefresh(deps as RoachOutDeps, 42);
    expect(ctxOf(build)).toMatchObject({ clientUrl: BASE });
  });

  it('signup listener context uses the settings client URL', async () => {
    const { module } = await createSignupInteractionTestModule();
    const svc = module.get<{ getClientUrl?: unknown }>(SettingsService);
    svc.getClientUrl = jest.fn().mockResolvedValue(BASE);
    const listener = module.get(SignupInteractionListener);
    const ctx = await listener['buildEmbedContext'](42);
    expect(ctx).toMatchObject({ clientUrl: BASE });
  });
});
