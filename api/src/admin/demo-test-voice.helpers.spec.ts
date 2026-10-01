import type { ModuleRef } from '@nestjs/core';
import { VoiceAttendanceService } from '../discord-bot/services/voice-attendance.service';
import { flushVoiceSessionsForTest } from './demo-test-voice.helpers';

/**
 * MUTATION: skip `flushToDb()` in flushVoiceSessionsForTest and the first case
 * fails on `toHaveBeenCalledTimes(1)`; swallow its rejection and the second
 * case fails on `rejects.toThrow`.
 */

/** ModuleRef stub whose only provider is the given voice attendance service. */
function moduleRefWith(svc: { flushToDb: jest.Mock }): {
  moduleRef: ModuleRef;
  get: jest.Mock;
} {
  const get = jest.fn().mockReturnValue(svc);
  return { moduleRef: { get } as unknown as ModuleRef, get };
}

describe('flushVoiceSessionsForTest', () => {
  it('resolves VoiceAttendanceService non-strictly and flushes it once', async () => {
    const flushToDb = jest.fn().mockResolvedValue(undefined);
    const { moduleRef, get } = moduleRefWith({ flushToDb });

    const result = await flushVoiceSessionsForTest(moduleRef);

    expect(result).toEqual({ success: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(VoiceAttendanceService, { strict: false });
    expect(flushToDb).toHaveBeenCalledTimes(1);
  });

  it('propagates a flushToDb rejection instead of reporting success', async () => {
    const flushToDb = jest.fn().mockRejectedValue(new Error('db down'));
    const { moduleRef } = moduleRefWith({ flushToDb });

    await expect(flushVoiceSessionsForTest(moduleRef)).rejects.toThrow(
      'db down',
    );
    expect(flushToDb).toHaveBeenCalledTimes(1);
  });
});
