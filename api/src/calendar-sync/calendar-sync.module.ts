import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsModule } from '../settings/settings.module';
import { CalendarSyncEnabledGuard } from './calendar-sync-enabled.guard';
import { CalendarConnectionsController } from './controllers/calendar-connections.controller';
import { CalendarSyncAdminController } from './controllers/calendar-sync-admin.controller';

/**
 * ROK-1591: Calendar Sync foundation (epic ROK-669) — the overview route, the
 * admin settings API and the kill-switch guard. OAuth, queues and crons
 * arrive with ROK-1592+.
 */
@Module({
  imports: [DrizzleModule, SettingsModule],
  controllers: [CalendarConnectionsController, CalendarSyncAdminController],
  providers: [CalendarSyncEnabledGuard],
  exports: [CalendarSyncEnabledGuard],
})
export class CalendarSyncModule {}
