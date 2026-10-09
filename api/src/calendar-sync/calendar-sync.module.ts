import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarSyncEnabledGuard } from './calendar-sync-enabled.guard';
import { CalendarConnectionsController } from './controllers/calendar-connections.controller';
import { CalendarDemoSeedController } from './controllers/calendar-demo-seed.controller';
import { CalendarOAuthController } from './controllers/calendar-oauth.controller';
import { CalendarSyncAdminController } from './controllers/calendar-sync-admin.controller';
import {
  CALENDAR_FAKE_PROVIDER,
  CalendarProviderRegistry,
} from './providers/calendar-provider.registry';
import { GoogleCalendarAdapter } from './providers/google/google.adapter';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';

/**
 * L15: the Fake is always constructed (an inert in-memory object) but is
 * reachable only through two request-time gates — the registry's
 * `fakeAllowed()` and the seed controller's `assertDemoMode()` — that both
 * check env `DEMO_MODE=true` AND the `demo_mode` setting on every call,
 * exactly like the `/admin/test/*` endpoints in
 * `admin/demo-test-core.controller.ts`. A boot-time env read would freeze
 * demo mode at whatever the env was when the app started (the integration
 * singleton boots before any spec sets DEMO_MODE).
 */
const fakeProvider = {
  provide: CALENDAR_FAKE_PROVIDER,
  useFactory: (): FakeCalendarProvider => new FakeCalendarProvider(),
};

/**
 * Calendar Sync (epic ROK-669). ROK-1591: overview, admin settings, kill
 * switch. ROK-1592: Google OAuth connect/disconnect, provider registry and
 * the DEMO_MODE seed endpoint. Queues and crons arrive with ROK-1593+.
 */
@Module({
  imports: [DrizzleModule, SettingsModule],
  controllers: [
    CalendarConnectionsController,
    CalendarOAuthController,
    CalendarDemoSeedController,
    CalendarSyncAdminController,
  ],
  providers: [
    CalendarSyncEnabledGuard,
    GoogleCalendarAdapter,
    CalendarProviderRegistry,
    fakeProvider,
  ],
  exports: [CalendarSyncEnabledGuard, CalendarProviderRegistry],
})
export class CalendarSyncModule {}
