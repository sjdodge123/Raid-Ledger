import { NotFoundException } from '@nestjs/common';
import { SETTING_KEYS } from '../drizzle/schema';
import type { SettingsService } from '../settings/settings.service';
import { CalendarSyncEnabledGuard } from './calendar-sync-enabled.guard';

function guardWith(value: string | null): CalendarSyncEnabledGuard {
  const get = jest.fn((key: string) =>
    Promise.resolve(key === SETTING_KEYS.CALENDAR_SYNC_ENABLED ? value : null),
  );
  return new CalendarSyncEnabledGuard({ get } as unknown as SettingsService);
}

describe('CalendarSyncEnabledGuard (ROK-1591, D8)', () => {
  it('throws NotFoundException when the kill switch is unset', async () => {
    await expect(guardWith(null).canActivate()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('throws NotFoundException when the kill switch is "false"', async () => {
    await expect(guardWith('false').canActivate()).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('allows the request when the kill switch is "true"', async () => {
    await expect(guardWith('true').canActivate()).resolves.toBe(true);
  });
});
