import {
  CanActivate,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';

export const DEMO_MODE_ONLY_MESSAGE = 'Only available in DEMO_MODE';

/**
 * Class-level gate for every `/admin/test/*` controller (ROK-1757).
 *
 * Requires DEMO_MODE in BOTH `process.env` and the DB setting — the same two
 * checks every per-method `assertDemoMode` makes, with the same 403 — so a
 * newly added handler that forgets its own check is still closed. Runs AFTER
 * the JWT + admin guards (list it last in `@UseGuards`).
 *
 * `SettingsService` is optional only so unit-test modules that never run
 * guards can compile without it; a missing service fails CLOSED.
 */
@Injectable()
export class DemoModeGuard implements CanActivate {
  constructor(@Optional() private readonly settings?: SettingsService) {}

  async canActivate(): Promise<boolean> {
    if (process.env.DEMO_MODE !== 'true') {
      throw new ForbiddenException(DEMO_MODE_ONLY_MESSAGE);
    }
    if (!this.settings || !(await this.settings.getDemoMode())) {
      throw new ForbiddenException(DEMO_MODE_ONLY_MESSAGE);
    }
    return true;
  }
}
