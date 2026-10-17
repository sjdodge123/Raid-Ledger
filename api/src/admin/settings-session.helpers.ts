import { BadRequestException, Logger } from '@nestjs/common';
import { SessionLengthSchema } from '@raid-ledger/contract';
import type { SettingsService } from '../settings/settings.service';
import {
  getSessionLengthDays,
  setSessionLengthDays,
} from '../settings/settings-session.helpers';

/** Read the current admin session-length setting (GET /admin/settings/session). */
export async function readSessionLength(
  settings: SettingsService,
): Promise<{ sessionLengthDays: number }> {
  return { sessionLengthDays: await getSessionLengthDays(settings) };
}

/**
 * ROK-1353: validate + persist the admin session-length setting. Extracted
 * from settings.controller.ts to keep that file under the 300-line ESLint cap.
 */
export async function persistSessionLength(
  settings: SettingsService,
  logger: Logger,
  body: { sessionLengthDays?: unknown },
): Promise<{ success: boolean; sessionLengthDays: number }> {
  const parsed = SessionLengthSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException('sessionLengthDays must be an integer 1–365');
  }
  await setSessionLengthDays(settings, parsed.data.sessionLengthDays);
  logger.log(
    `Session length updated to ${parsed.data.sessionLengthDays} days via admin UI`,
  );
  return { success: true, sessionLengthDays: parsed.data.sessionLengthDays };
}
