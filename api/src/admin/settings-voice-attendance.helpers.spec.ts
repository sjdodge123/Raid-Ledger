/**
 * ROK-1940 D8: validation + persistence of the admin voice-attendance grace
 * window (GET/PUT /admin/settings/voice-attendance).
 */
import { BadRequestException, Logger } from '@nestjs/common';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';
import {
  persistVoiceAttendanceSettings,
  readVoiceAttendanceSettings,
  type VoiceAttendanceSettingsStore,
} from './settings-voice-attendance.helpers';

const KEY = SETTING_KEYS.VOICE_ATTENDANCE_GRACE_MINUTES;

function makeStore(initial: string | null = null) {
  let value = initial;
  const set = jest.fn((_key: typeof KEY, v: string) => {
    value = v;
    return Promise.resolve();
  });
  const store: VoiceAttendanceSettingsStore = {
    get: () => Promise.resolve(value),
    set,
  };
  return { store, set };
}

const logger = { log: jest.fn() } as unknown as Logger;

describe('persistVoiceAttendanceSettings', () => {
  it.each([0, 60, 5])('persists graceMinutes=%p', async (graceMinutes) => {
    const { store, set } = makeStore();
    await expect(
      persistVoiceAttendanceSettings(store, logger, { graceMinutes }),
    ).resolves.toEqual({ graceMinutes });
    expect(set).toHaveBeenCalledWith(KEY, String(graceMinutes));
    await expect(readVoiceAttendanceSettings(store)).resolves.toEqual({
      graceMinutes,
    });
  });

  it.each([
    ['-1', { graceMinutes: -1 }],
    ['61', { graceMinutes: 61 }],
    ['2.5', { graceMinutes: 2.5 }],
    ['the string "7"', { graceMinutes: '7' }],
    ['a missing field', {}],
    ['an undefined body', undefined],
  ])('rejects %s with a 400 and writes nothing', async (_label, body) => {
    const { store, set } = makeStore();
    await expect(
      persistVoiceAttendanceSettings(store, logger, body),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(set).not.toHaveBeenCalled();
  });
});

describe('readVoiceAttendanceSettings', () => {
  it('returns the default 5 when nothing is saved', async () => {
    const { store } = makeStore(null);
    await expect(readVoiceAttendanceSettings(store)).resolves.toEqual({
      graceMinutes: 5,
    });
  });

  it('returns the saved value', async () => {
    const { store } = makeStore('12');
    await expect(readVoiceAttendanceSettings(store)).resolves.toEqual({
      graceMinutes: 12,
    });
  });
});
