/**
 * ROK-1612 AC6 — the admin surface for the pinned composer card's opt-in:
 * GET reports it, PUT persists it and hands the Discord side to
 * `LfgComposerPinService` via `COMPOSER_TOGGLED`, both behind the admin guard.
 */
import { Test } from '@nestjs/testing';
import { ForbiddenException, type INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AuthGuard } from '@nestjs/passport';
import { EventEmitter2 } from '@nestjs/event-emitter';
import supertest from 'supertest';
import { AdminGuard } from '../auth/admin.guard';
import { LfgBoardSettingsController } from './lfg-board-settings.controller';
import { DiscordBotClientService } from './discord-bot-client.service';
import { SettingsService } from '../settings/settings.service';
import { LFG_BOARD_EVENTS } from './lfg-board/lfg-board.constants';
import { SETTING_KEYS } from '../drizzle/schema';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const URL = '/admin/settings/discord-bot/lfg-board';

describe('LfgBoardSettingsController — composer opt-in (ROK-1612 AC6)', () => {
  let app: INestApplication;
  const store = new Map<string, string>();
  const emit = jest.fn(() => Promise.resolve([]));
  const settings = {
    get: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    set: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
  };
  let isAdmin = true;

  beforeEach(async () => {
    store.clear();
    jest.clearAllMocks();
    isAdmin = true;
    const moduleRef = await Test.createTestingModule({
      controllers: [LfgBoardSettingsController],
      providers: [
        { provide: SettingsService, useValue: settings },
        { provide: DiscordBotClientService, useValue: {} },
        { provide: EventEmitter2, useValue: { emitAsync: emit } },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({
        canActivate: () => {
          if (!isAdmin) throw new ForbiddenException();
          return true;
        },
      })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  const http = (): Server => app.getHttpServer() as Server;

  it('GET reports the opt-in as off by default', async () => {
    const res = await supertest(http()).get(URL);
    expect(res.status).toBe(200);
    expect(res.body.composerEnabled).toBe(false);
  });

  it('GET reports the opt-in once it is on', async () => {
    store.set(SETTING_KEYS.LFG_COMPOSER_ENABLED, 'true');
    const res = await supertest(http()).get(URL);
    expect(res.body.composerEnabled).toBe(true);
  });

  it('PUT on persists the key and triggers the pin service', async () => {
    const res = await supertest(http())
      .put(`${URL}/composer`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true });
    expect(store.get(SETTING_KEYS.LFG_COMPOSER_ENABLED)).toBe('true');
    expect(emit).toHaveBeenCalledWith(
      LFG_BOARD_EVENTS.COMPOSER_TOGGLED,
      undefined,
    );
    // Never the board's own toggle — that would retire every live post.
    expect(emit).not.toHaveBeenCalledWith(
      LFG_BOARD_EVENTS.TOGGLED,
      expect.anything(),
    );
  });

  it('PUT off persists "false" and triggers the pin service off path', async () => {
    store.set(SETTING_KEYS.LFG_COMPOSER_ENABLED, 'true');
    const res = await supertest(http())
      .put(`${URL}/composer`)
      .send({ enabled: false });

    expect(res.body).toEqual({ enabled: false });
    expect(store.get(SETTING_KEYS.LFG_COMPOSER_ENABLED)).toBe('false');
    expect(emit).toHaveBeenCalledWith(
      LFG_BOARD_EVENTS.COMPOSER_TOGGLED,
      undefined,
    );
  });

  it('PUT rejects a non-boolean body without persisting or emitting', async () => {
    const res = await supertest(http())
      .put(`${URL}/composer`)
      .send({ enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(settings.set).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('non-admins get 403 on both routes and nothing is written', async () => {
    isAdmin = false;
    const get = await supertest(http()).get(URL);
    const put = await supertest(http())
      .put(`${URL}/composer`)
      .send({ enabled: true });

    expect(get.status).toBe(403);
    expect(put.status).toBe(403);
    expect(settings.set).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
