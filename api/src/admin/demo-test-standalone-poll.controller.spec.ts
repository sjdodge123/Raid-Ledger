/**
 * ROK-1604 (lane F) — the DEMO_MODE-only run-now hook for the scheduling-poll
 * expiry sweep. The smoke test pushes a poll's deadline into the past and
 * calls this so the card re-renders as `POLL EXPIRED` without waiting for the
 * 5-minute cron. Pinned: it is gated twice (env var AND setting) and it runs
 * the sweep to completion before answering.
 */
import { ForbiddenException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { DemoTestStandalonePollController } from './demo-test-standalone-poll.controller';

const settings = { getDemoMode: jest.fn() };
const reminders = { runReminders: jest.fn() };
const expiry = { runSweep: jest.fn() };

function controller(): DemoTestStandalonePollController {
  return new DemoTestStandalonePollController(
    {} as never,
    settings as unknown as SettingsService,
    reminders as never,
    expiry as never,
  );
}

const ORIGINAL_DEMO_MODE = process.env.DEMO_MODE;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DEMO_MODE = 'true';
  settings.getDemoMode.mockResolvedValue(true);
  expiry.runSweep.mockResolvedValue(undefined);
});

afterAll(() => {
  process.env.DEMO_MODE = ORIGINAL_DEMO_MODE;
});

describe('DemoTestStandalonePollController.runPollExpirySweep', () => {
  it('runs the expiry sweep once and reports success', async () => {
    expect(await controller().runPollExpirySweep()).toEqual({
      success: true,
    });
    expect(expiry.runSweep).toHaveBeenCalledTimes(1);
  });

  it('awaits the sweep before answering', async () => {
    let finished = false;
    expiry.runSweep.mockImplementation(async () => {
      await Promise.resolve();
      finished = true;
    });

    await controller().runPollExpirySweep();

    expect(finished).toBe(true);
  });

  it('refuses when the process is not in DEMO_MODE', async () => {
    process.env.DEMO_MODE = 'false';

    await expect(controller().runPollExpirySweep()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(expiry.runSweep).not.toHaveBeenCalled();
  });

  it('refuses when the DEMO_MODE setting is off, even with the env var set', async () => {
    settings.getDemoMode.mockResolvedValue(false);

    await expect(controller().runPollExpirySweep()).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(expiry.runSweep).not.toHaveBeenCalled();
  });
});
