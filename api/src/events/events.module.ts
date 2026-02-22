import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsService } from './events.service';
import { SignupsService } from './signups.service';
import { PugsService } from './pugs.service';
import { InviteService } from './invite.service';
import { OgMetaService } from './og-meta.service';
import { ShareService } from './share.service';
import { TemplatesService } from './templates.service';
import { EventsController } from './events.controller';
import { InviteController } from './invite.controller';
import { TemplatesController } from './templates.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { NotificationModule } from '../notifications/notification.module';
import { DiscordBotModule } from '../discord-bot/discord-bot.module';
import { SettingsModule } from '../settings/settings.module';
import {
  BenchPromotionService,
  BenchPromotionProcessor,
  BENCH_PROMOTION_QUEUE,
} from './bench-promotion.service';

@Module({
  imports: [
    AvailabilityModule,
    NotificationModule,
    SettingsModule,
    forwardRef(() => DiscordBotModule),
    BullModule.registerQueue({ name: BENCH_PROMOTION_QUEUE }),
  ],
  controllers: [EventsController, InviteController, TemplatesController],
  providers: [
    EventsService,
    SignupsService,
    PugsService,
    InviteService,
    OgMetaService,
    ShareService,
    TemplatesService,
    BenchPromotionService,
    BenchPromotionProcessor,
  ],
  exports: [EventsService, SignupsService, PugsService, InviteService],
})
export class EventsModule {}
