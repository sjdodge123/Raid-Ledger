import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DrizzleModule } from '../src/drizzle/drizzle.module';
import { SettingsModule } from '../src/settings/settings.module';
import { DemoDataService } from '../src/admin/demo-data.service';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * Standalone CLI script to install demo data.
 *
 * Uses the same DemoDataService as the admin panel "Install Demo Data" button,
 * ensuring identical results whether triggered from the CLI or the UI.
 *
 * Usage:
 *   npx ts-node api/scripts/seed-demo-data.ts          # Install demo data
 *   npx ts-node api/scripts/seed-demo-data.ts --clear   # Clear demo data
 */

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    EventEmitterModule.forRoot(),
    DrizzleModule,
    SettingsModule,
  ],
  providers: [DemoDataService],
})
class SeedDemoDataModule {}

async function bootstrap() {
  const clear = process.argv.includes('--clear');

  const app = await NestFactory.createApplicationContext(SeedDemoDataModule, {
    logger: ['error', 'warn', 'log'],
  });

  const demoDataService = app.get(DemoDataService);

  if (clear) {
    console.log('🧹 Clearing demo data...\n');
    const result = await demoDataService.clearDemoData();
    if (result.success) {
      console.log(`\n✅ ${result.message}`);
    } else {
      console.error(`\n❌ ${result.message}`);
      process.exitCode = 1;
    }
  } else {
    console.log('🎭 Installing demo data (same as admin panel button)...\n');
    const result = await demoDataService.installDemoData();
    if (result.success) {
      console.log(`\n✅ ${result.message}`);
      console.log(`   Counts: ${JSON.stringify(result.counts)}`);
    } else {
      // "already exists" is not an error — just skip
      if (result.message.includes('already exists')) {
        console.log(`\n⏭️  ${result.message}`);
      } else {
        console.error(`\n❌ ${result.message}`);
        process.exitCode = 1;
      }
    }
  }

  await app.close();
}

bootstrap().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
