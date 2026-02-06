import { Module } from '@nestjs/common';
import { DrizzleModule } from '../drizzle/drizzle.module';
import { SettingsService } from './settings.service';

@Module({
    imports: [
        DrizzleModule,
    ],
    providers: [SettingsService],
    exports: [SettingsService],
})
export class SettingsModule { }
