/**
 * ROK-1471 D10 — the DEMO_MODE-only debounce flush.
 *
 * Two claims worth pinning: the endpoint is genuinely gated (it drives Discord
 * writes, so an open one is a rate-limit gun aimed at production), and it goes
 * through `emitAsync` — the smoke test's whole reason for existing is that the
 * HTTP response must not return until the rename has actually landed.
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SettingsService } from '../settings/settings.service';
import { LFG_BOARD_EVENTS } from '../discord-bot/lfg-board/lfg-board.constants';
import { DemoTestLfgController } from './demo-test-lfg.controller';

const emitter = { emitAsync: jest.fn() };
const settings = { getDemoMode: jest.fn() };
const invites = { decline: jest.fn() };

function controller(): DemoTestLfgController {
  return new DemoTestLfgController(
    settings as unknown as SettingsService,
    emitter as unknown as EventEmitter2,
    invites as never,
    {} as never,
  );
}

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEMO_MODE = 'true';
  settings.getDemoMode.mockResolvedValue(true);
  emitter.emitAsync.mockResolvedValue([]);
  invites.decline.mockResolvedValue(true);
});

afterAll(() => {
  process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('DemoTestLfgController.flushBoardEdits', () => {
  it('awaits the FLUSH listeners so a smoke test can assert the thread name', async () => {
    expect(await controller().flushBoardEdits()).toEqual({ success: true });
    expect(emitter.emitAsync).toHaveBeenCalledWith(LFG_BOARD_EVENTS.FLUSH);
  });

  it('refuses when the process is not in DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(controller().flushBoardEdits()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });

  it('refuses when the DEMO_MODE setting is off, even with the env var set', async () => {
    settings.getDemoMode.mockResolvedValue(false);

    await expect(controller().flushBoardEdits()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(emitter.emitAsync).not.toHaveBeenCalled();
  });
});

describe('DemoTestLfgController.declineLfgInvite (ROK-1455 D15)', () => {
  it('presses the decline for the named user through LfgInviteService.decline', async () => {
    expect(
      await controller().declineLfgInvite({ userId: 7, gameId: 42 }),
    ).toEqual({ declined: true });
    expect(invites.decline).toHaveBeenCalledWith(7, 42);
  });

  it('rejects a body without positive integer ids', async () => {
    await expect(
      controller().declineLfgInvite({ userId: 'x', gameId: 42 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(invites.decline).not.toHaveBeenCalled();
  });

  it('refuses outside DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(
      controller().declineLfgInvite({ userId: 7, gameId: 42 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(invites.decline).not.toHaveBeenCalled();
  });
});
