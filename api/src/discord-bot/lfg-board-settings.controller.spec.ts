import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PermissionsBitField, type Guild } from 'discord.js';
import supertest, { type Test as SupertestRequest } from 'supertest';
import { AdminGuard } from '../auth/admin.guard';
import { LfgBoardSettingsController } from './lfg-board-settings.controller';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { LFG_BOARD_EVENTS } from './lfg-board/lfg-board.constants';
import { SETTING_KEYS } from '../drizzle/schema';

/** A guild whose bot member holds every permission except those denied. */
const guildDenying = (...denied: bigint[]): Guild =>
  ({
    members: {
      me: { permissions: { has: (f: bigint): boolean => !denied.includes(f) } },
    },
  }) as unknown as Guild;

describe('LfgBoardSettingsController (ROK-1471 D1/D5)', () => {
  let app: INestApplication;
  const store = new Map<string, string>();
  const get = jest.fn((k: string) => Promise.resolve(store.get(k) ?? null));
  const set = jest.fn((k: string, v: string) => {
    store.set(k, v);
    return Promise.resolve();
  });
  const isConnected = jest.fn<boolean, []>();
  const getGuild = jest.fn<Guild | null, []>();
  const emit = jest.fn();

  beforeEach(async () => {
    store.clear();
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      controllers: [LfgBoardSettingsController],
      providers: [
        { provide: SettingsService, useValue: { get, set } },
        {
          provide: DiscordBotClientService,
          useValue: { isConnected, getGuild },
        },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = (): Server => app.getHttpServer() as Server;

  const put = (enabled: boolean): SupertestRequest =>
    supertest(http())
      .put('/admin/settings/discord-bot/lfg-board')
      .send({ enabled });

  // T19 (R): a missing permission is a WARNING, never a rejection. The operator
  // is usually enabling the board so they can then fix the install; a 4xx here
  // would leave the setting off and the warning unexplained.
  it('persists an enable and warns about the missing thread permission', async () => {
    isConnected.mockReturnValue(true);
    getGuild.mockReturnValue(
      guildDenying(PermissionsBitField.Flags.SendMessagesInThreads),
    );

    const res = await put(true);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      enabled: true,
      warning: { missing: ['Send Messages in Threads'] },
    });
    expect([...store.values()]).toEqual(['true']);
    expect(emit).toHaveBeenCalledWith(LFG_BOARD_EVENTS.TOGGLED, {
      enabled: true,
    });
  });

  it('returns no warning when every board permission is granted', async () => {
    isConnected.mockReturnValue(true);
    getGuild.mockReturnValue(guildDenying());

    const res = await put(true);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
    expect([...store.values()]).toEqual(['true']);
  });

  it('persists and emits on disable, and never preflights', async () => {
    isConnected.mockReturnValue(true);
    getGuild.mockReturnValue(
      guildDenying(PermissionsBitField.Flags.ManageThreads),
    );

    const res = await put(false);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false });
    expect([...store.values()]).toEqual(['false']);
    expect(emit).toHaveBeenCalledWith(LFG_BOARD_EVENTS.TOGGLED, {
      enabled: false,
    });
  });

  it('persists with no warning when the bot is not connected', async () => {
    isConnected.mockReturnValue(false);
    getGuild.mockReturnValue(null);

    const res = await put(true);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-boolean body without persisting or emitting', async () => {
    const res = await supertest(http())
      .put('/admin/settings/discord-bot/lfg-board')
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(store.size).toBe(0);
    expect(emit).not.toHaveBeenCalled();
  });

  // `channelId: null` is asserted EXACTLY, not merely "not the id": the board
  // listener creates the forum asynchronously, so a GET taken right after the
  // enable must be able to say "not yet" rather than omit the field — that is
  // the difference between a caller polling and a caller giving up.
  it('reports the stored state, defaulting to off with no channel', async () => {
    const off = await supertest(http()).get(
      '/admin/settings/discord-bot/lfg-board',
    );
    expect(off.body).toEqual({ enabled: false, channelId: null });

    await put(true);
    const on = await supertest(http()).get(
      '/admin/settings/discord-bot/lfg-board',
    );
    expect(on.body).toEqual({ enabled: true, channelId: null });
  });

  // The reason the field exists (ROK-1471 D-smoke): a caller must be able to
  // find the bot's forum by id. Guessing by the channel NAME is ambiguous — a
  // guild may already hold an unrelated channel called `lfg`.
  it('reports the forum channel id once the board listener has created it', async () => {
    store.set(SETTING_KEYS.LFG_BOARD_ENABLED, 'true');
    store.set(SETTING_KEYS.LFG_BOARD_CHANNEL_ID, '999888777');

    const res = await supertest(http()).get(
      '/admin/settings/discord-bot/lfg-board',
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, channelId: '999888777' });
  });
});
