import { BadRequestException, Logger } from '@nestjs/common';
import {
  VoiceAttendanceSettingsSchema,
  type VoiceAttendanceSettingsDto,
} from '@raid-ledger/contract';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import { parseGraceMinutes } from '../discord-bot/services/voice-attendance.helpers';

/** Minimal surface of SettingsService needed by these helpers. */
export interface VoiceAttendanceSettingsStore {
  get(
    key: typeof SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
  ): Promise<string | null>;
  set(
    key: typeof SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
    value: string,
  ): Promise<void>;
}

/** ROK-1940: the effective grace window (default 5) for GET. */
export async function readVoiceAttendanceSettings(
  settings: VoiceAttendanceSettingsStore,
): Promise<VoiceAttendanceSettingsDto> {
  const raw = await settings.get(SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES);
  return { graceMinutes: parseGraceMinutes(raw) };
}

/** ROK-1940: validate (integer 0–60) + persist the grace window for PUT. */
export async function persistVoiceAttendanceSettings(
  settings: VoiceAttendanceSettingsStore,
  logger: Logger,
  body: unknown,
): Promise<VoiceAttendanceSettingsDto> {
  const parsed = VoiceAttendanceSettingsSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException('graceMinutes must be an integer 0–60');
  }
  const { graceMinutes } = parsed.data;
  await settings.set(
    SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES,
    String(graceMinutes),
  );
  logger.log(`Voice attendance grace updated to ${graceMinutes} min`);
  return { graceMinutes };
}
