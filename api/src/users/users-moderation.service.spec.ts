/**
 * Unit tests for UsersModerationService — verifies it maps controller args onto
 * the orchestration helpers and audit query (the cascade logic itself is covered
 * by users-moderation-orchestration.helpers.spec.ts). The orchestration + deps +
 * audit modules are mocked so this stays a pure delegation test.
 */
import { Logger } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { UsersModerationService } from './users-moderation.service';
import * as orchestration from './users-moderation-orchestration.helpers';
import * as deps from './users-moderation-deps.helpers';
import * as audit from './users-admin-actions.helpers';

jest.mock('./users-moderation-orchestration.helpers');
jest.mock('./users-moderation-deps.helpers');
jest.mock('./users-admin-actions.helpers');

const runKick = orchestration.runKick as jest.Mock;
const runUnkick = orchestration.runUnkick as jest.Mock;
const runBan = orchestration.runBan as jest.Mock;
const runUnban = orchestration.runUnban as jest.Mock;
const buildModerationDeps = deps.buildModerationDeps as jest.Mock;
const insertAdminAction = audit.insertAdminAction as jest.Mock;
const getAdminActionsForUser = audit.getAdminActionsForUser as jest.Mock;

const SENTINEL_DEPS = { sentinel: true };
const mockDb = { db: true } as never;
const mockModuleRef = {} as ModuleRef;
const mockDiscord = { kickMember: jest.fn() } as never;

let service: UsersModerationService;

beforeEach(() => {
  jest.clearAllMocks();
  buildModerationDeps.mockReturnValue(SENTINEL_DEPS);
  service = new UsersModerationService(mockDb, mockModuleRef, mockDiscord);
});

it('kickUser maps args and delegates to runKick', async () => {
  runKick.mockResolvedValue({ success: true, message: 'ok' });
  await service.kickUser(9, 5, { reason: 'x', kickFromDiscord: true });
  expect(buildModerationDeps).toHaveBeenCalledWith(
    mockModuleRef,
    mockDb,
    expect.any(Logger),
    mockDiscord,
  );
  expect(runKick).toHaveBeenCalledWith(SENTINEL_DEPS, {
    userId: 5,
    actorId: 9,
    reason: 'x',
    kickFromDiscord: true,
  });
});

it('banUser threads wipeData + kickFromDiscord to runBan', async () => {
  runBan.mockResolvedValue({ success: true, message: 'ok' });
  await service.banUser(9, 5, {
    reason: 'y',
    wipeData: true,
    kickFromDiscord: false,
  });
  expect(runBan).toHaveBeenCalledWith(SENTINEL_DEPS, {
    userId: 5,
    actorId: 9,
    reason: 'y',
    wipeData: true,
    kickFromDiscord: false,
  });
});

it('unkickUser / unbanUser delegate with (userId, actorId)', async () => {
  runUnkick.mockResolvedValue({ success: true, message: 'ok' });
  runUnban.mockResolvedValue({ success: true, message: 'ok' });
  await service.unkickUser(9, 5);
  await service.unbanUser(9, 5);
  expect(runUnkick).toHaveBeenCalledWith(SENTINEL_DEPS, 5, 9);
  expect(runUnban).toHaveBeenCalledWith(SENTINEL_DEPS, 5, 9);
});

it('logAdminAction and getAdminActionsForUser delegate to the audit helpers', async () => {
  const input = { action: 'role_change' as const, actorId: 9, targetId: 5 };
  await service.logAdminAction(input);
  expect(insertAdminAction).toHaveBeenCalledWith(mockDb, input);
  await service.getAdminActionsForUser(5, 2, 20);
  expect(getAdminActionsForUser).toHaveBeenCalledWith(mockDb, 5, 2, 20);
});
