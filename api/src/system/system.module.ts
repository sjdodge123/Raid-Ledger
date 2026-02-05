import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { UsersModule } from '../users/users.module';

/**
 * System module (ROK-175).
 * Provides system status endpoint for first-run detection.
 */
@Module({
    imports: [UsersModule],
    controllers: [SystemController],
})
export class SystemModule { }
