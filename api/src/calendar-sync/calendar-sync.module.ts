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
 * L15: the Fake exists only when the app boots with DEMO_MODE=true (a
 * factory, so the env is read at app init, not at import). The registry and
 * the seed endpoint still check env + the `demo_mode` setting per call.
 */
const fakeProvider = {
  provide: CALENDAR_FAKE_PROVIDER,
  useFactory: (): FakeCalendarProvider | null =>
    process.env.DEMO_MODE === 'true' ? new FakeCalendarProvider() : null,
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
