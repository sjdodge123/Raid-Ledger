/**
 * ROK-1767: PUT /admin/settings/discord-bot/game-roles/:gameId — 422 with the
 * problem list on a failed preflight; `roleId: null` creates the role.
 */
import { Test } from '@nestjs/testing';
import { type INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import { AuthGuard } from '@nestjs/passport';
import supertest from 'supertest';
import type { GameRolePreflightDto } from '@raid-ledger/contract';
import { AdminGuard } from '../../auth/admin.guard';
import { DrizzleAsyncProvider } from '../../drizzle/drizzle.module';
import { DiscordBotClientService } from '../discord-bot-client.service';
import * as discord from './game-role-discord.helpers';
import * as settings from './game-roles-settings.helpers';
import { GameRoleReconcileService } from './game-role-reconcile.service';
import { GameRolesSettingsController } from './game-roles-settings.controller';

jest.mock('./game-role-discord.helpers');
jest.mock('./game-roles-settings.helpers');
const d = jest.mocked(discord);
const s = jest.mocked(settings);
const URL = '/admin/settings/discord-bot/game-roles/7';
const OK: GameRolePreflightDto = { ok: true, problems: [] };
const SUMMARY = {
  gameId: 7,
  gameName: 'Valheim',
  roleId: 'new-role',
  roleName: 'Valheim',
  botCreated: true,
  windowDays: 14,
  enabled: true,
  lastReconciledAt: null,
  grantedCount: 0,
};

describe('GameRolesSettingsController (ROK-1767)', () => {
  let app: INestApplication;
  const guild = { id: 'g' };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [GameRolesSettingsController],
      providers: [
        { provide: DrizzleAsyncProvider, useValue: {} },
        {
          provide: DiscordBotClientService,
          useValue: { getGuild: () => guild },
        },
        { provide: GameRoleReconcileService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard('jwt'))
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = mod.createNestApplication();
    await app.init();
  });

  afterAll(() => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    s.findGameName.mockResolvedValue('Valheim');
    s.findGameRoleLink.mockResolvedValue(null);
    s.saveGameRole.mockResolvedValue(undefined);
    s.listGameRoleSummaries.mockResolvedValue([SUMMARY]);
  });

  const put = (body: object) =>
    supertest(app.getHttpServer() as Server)
      .put(URL)
      .send(body);

  it('returns 422 with the problems and saves nothing when preflight fails', async () => {
    const problems: GameRolePreflightDto['problems'] = [
      { code: 'role_above_bot', message: 'Move the bot role up' },
    ];
    d.preflightGameRole.mockImplementation((_g, roleId) =>
      Promise.resolve(roleId === null ? OK : { ok: false, problems }),
    );

    const res = await put({ roleId: '123', windowDays: 14 });

    expect(res.status).toBe(422);
    expect((res.body as { problems: unknown }).problems).toEqual(problems);
    expect(s.saveGameRole).not.toHaveBeenCalled();
  });

  it('creates the role when roleId is null and saves it as bot-created', async () => {
    d.preflightGameRole.mockResolvedValue(OK);
    d.createGameRole.mockResolvedValue({ id: 'new-role', name: 'smoke-gr-x' });

    const res = await put({ roleId: null, windowDays: 10, name: 'smoke-gr-x' });

    expect(res.status).toBe(200);
    expect(d.createGameRole).toHaveBeenCalledWith(guild, 'smoke-gr-x');
    expect(s.saveGameRole).toHaveBeenCalledWith(
      {},
      {
        gameId: 7,
        roleId: 'new-role',
        botCreated: true,
        windowDays: 10,
        enabled: true,
      },
    );
  });

  describe('editing an existing link', () => {
    const LINKED = { roleId: 'old-role', botCreated: true };
    const FAIL: GameRolePreflightDto = {
      ok: false,
      problems: [{ code: 'role_not_found', message: 'Role not found' }],
    };

    beforeEach(() => s.findGameRoleLink.mockResolvedValue(LINKED));

    it('roleId null keeps the current role instead of creating a second one', async () => {
      d.preflightGameRole.mockResolvedValue(OK);

      const res = await put({ roleId: null, windowDays: 30 });

      expect(res.status).toBe(200);
      expect(d.createGameRole).not.toHaveBeenCalled();
      expect(s.saveGameRole).toHaveBeenCalledWith(
        {},
        {
          gameId: 7,
          roleId: 'old-role',
          botCreated: true,
          windowDays: 30,
          enabled: true,
        },
      );
    });

    it('refuses a different role with 409 and saves nothing', async () => {
      d.preflightGameRole.mockResolvedValue(OK);

      const res = await put({ roleId: 'other-role', windowDays: 14 });

      expect(res.status).toBe(409);
      expect(s.saveGameRole).not.toHaveBeenCalled();
    });

    it('can be disabled even while its preflight fails', async () => {
      d.preflightGameRole.mockResolvedValue(FAIL);

      const res = await put({
        roleId: 'old-role',
        windowDays: 14,
        enabled: false,
      });

      expect(res.status).toBe(200);
      expect(s.saveGameRole).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ roleId: 'old-role', enabled: false }),
      );
    });
  });

  it('deletes the role it just created when the post-create preflight fails', async () => {
    d.preflightGameRole.mockImplementation((_g, roleId) =>
      Promise.resolve(
        roleId === 'new-role'
          ? {
              ok: false,
              problems: [{ code: 'role_above_bot', message: 'nope' }],
            }
          : OK,
      ),
    );
    d.createGameRole.mockResolvedValue({ id: 'new-role', name: 'Valheim' });

    const res = await put({ roleId: null, windowDays: 14 });

    expect(res.status).toBe(422);
    expect(d.deleteCreatedRole).toHaveBeenCalledWith(guild, 'new-role');
    expect(s.saveGameRole).not.toHaveBeenCalled();
  });
});
