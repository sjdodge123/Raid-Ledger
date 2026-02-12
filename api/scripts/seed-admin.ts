import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '../src/drizzle/drizzle.module';
import { UsersModule } from '../src/users/users.module';
import { UsersService } from '../src/users/users.service';
import * as dotenv from 'dotenv';

dotenv.config();

@Module({
    imports: [
        ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
        DrizzleModule,
        UsersModule,
    ],
})
class SeedModule { }

async function bootstrap() {
    const discordId = process.argv[2];
    if (!discordId) {
        console.error('Usage: npx ts-node scripts/seed-admin.ts <discord_id>');
        process.exit(1);
    }

    const app = await NestFactory.createApplicationContext(SeedModule);
    const usersService = app.get(UsersService);

    console.log(`Promoting user with Discord ID: ${discordId} to ADMIN...`);

    try {
        const user = await usersService.findByDiscordId(discordId);
        if (!user) {
            console.error('❌ User not found. Please login via Discord first to create the account.');
            await app.close();
            process.exit(1);
        }
        const updated = await usersService.setRole(user.id, 'admin');
        console.log('✅ User promoted successfully:', updated.username);
    } catch (err) {
        console.error('❌ Failed to promote user:', err);
    } finally {
        await app.close();
    }
}

bootstrap();
