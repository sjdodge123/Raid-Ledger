import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CronJobModule } from '../cron-jobs/cron-job.module';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { EventsModule } from '../events/events.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarSyncEnabledGuard } from './calendar-sync-enabled.guard';
import { CALENDAR_WRITE_QUEUE } from './calendar-sync.constants';
import { CalendarConnectionsController } from './controllers/calendar-connections.controller';
import { CalendarDemoSeedController } from './controllers/calendar-demo-seed.controller';
import { CalendarOAuthController } from './controllers/calendar-oauth.controller';
import { CalendarSyncAdminController } from './controllers/calendar-sync-admin.controller';
import { EventCalendarController } from './controllers/event-calendar.controller';
import {
  CALENDAR_FAKE_PROVIDER,
  CalendarProviderRegistry,
} from './providers/calendar-provider.registry';
import { GoogleCalendarAdapter } from './providers/google/google.adapter';
import { FakeCalendarProvider } from './providers/testing/fake-calendar.provider';
import { CalendarWriteListener } from './write/calendar-write.listener';
import { CalendarWriteProcessor } from './write/calendar-write.processor';
import { CalendarWriteReconcileCron } from './write/calendar-write-reconcile.cron';

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
 * the DEMO_MODE seed endpoint. ROK-1596: the write queue.
 */
@Module({
  imports: [
    DrizzleModule,
    SettingsModule,
    EventsModule,
    CronJobModule,
    BullModule.registerQueue({ name: CALENDAR_WRITE_QUEUE }),
  ],
  controllers: [
    CalendarConnectionsController,
    CalendarOAuthController,
    CalendarDemoSeedController,
    CalendarSyncAdminController,
    EventCalendarController,
  ],
  providers: [
    CalendarSyncEnabledGuard,
    GoogleCalendarAdapter,
    CalendarProviderRegistry,
    fakeProvider,
    CalendarWriteProcessor,
    CalendarWriteListener,
    CalendarWriteReconcileCron,
  ],
  exports: [CalendarSyncEnabledGuard, CalendarProviderRegistry],
})
export class CalendarSyncModule {}
