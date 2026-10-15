/**
 * ROK-1313: unit cover for the POST /feedback submit helpers — the pre-parse
 * 413 and the "file write failed, report still saved" path.
 */
import { Logger, PayloadTooLargeException } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import * as path from 'path';
import { FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS } from '@raid-ledger/contract';
import { parseFeedbackBody, storeScreenshot } from './feedback-submit.helpers';

jest.mock('@sentry/nestjs', () => ({ captureException: jest.fn() }));

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ORIGINAL_DIR = process.env.RAID_LEDGER_FEEDBACK_DIR;

afterAll(() => {
  if (ORIGINAL_DIR === undefined) delete process.env.RAID_LEDGER_FEEDBACK_DIR;
  else process.env.RAID_LEDGER_FEEDBACK_DIR = ORIGINAL_DIR;
});

describe('parseFeedbackBody', () => {
  it('throws 413 (not a zod 400) for an over-cap screenshot', () => {
    const body = {
      category: 'bug',
      message: 'x',
      screenshotBase64: 'A'.repeat(FEEDBACK_SCREENSHOT_MAX_BASE64_CHARS + 1),
    };
    expect(() => parseFeedbackBody(body)).toThrow(PayloadTooLargeException);
  });
});

describe('storeScreenshot', () => {
  it('logs + reports to Sentry and does not throw when the write fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rl-fb-unit-'));
    process.env.RAID_LEDGER_FEEDBACK_DIR = dir;
    await writeFile(path.join(dir, '7.png'), 'taken'); // `wx` → EEXIST
    const update = jest.fn();
    const db = { update } as unknown as Parameters<typeof storeScreenshot>[0];
    const logger = new Logger('spec');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    await expect(
      storeScreenshot(db, 7, { buf: PNG, ext: 'png' }, logger),
    ).resolves.toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to store screenshot for feedback 7'),
    );
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    await rm(dir, { recursive: true, force: true });
  });
});
