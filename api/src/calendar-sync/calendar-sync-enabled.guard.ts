import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import { getCalendarSyncEnabled } from '../settings/settings-calendar-sync.helpers';

/**
 * ROK-1591: gate for Calendar Sync user routes. With the admin kill switch
 * off the routes 404 (spec §8, D8) rather than 403 — the feature does not
 * exist yet as far as a user can tell. `GET /users/me/calendars` is NOT
 * behind it: that route reports `enabled: false` instead.
 */
@Injectable()
export class CalendarSyncEnabledGuard implements CanActivate {
  constructor(private readonly settings: SettingsService) {}

  async canActivate(): Promise<boolean> {
    if (!(await getCalendarSyncEnabled(this.settings))) {
      throw new NotFoundException();
    }
    return true;
  }
}
