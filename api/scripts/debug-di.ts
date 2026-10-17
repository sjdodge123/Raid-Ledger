import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DrizzleModule } from '../src/drizzle/drizzle.module';
import { UsersModule } from '../src/users/users.module';
import { UsersService } from '../src/users/users.service';
import * as dotenv from 'dotenv';
dotenv.config();
console.log('DEBUG ENV:', process.env.DISCORD_CLIENT_ID);
import { AuthModule } from '../src/auth/auth.module';

@Module({
    imports: [ConfigModule.forRoot({ isGlobal: true }), DrizzleModule, UsersModule, AuthModule],
})
class DebugModule { }

async function debug() {
    console.log('Starting Debug DI...');
    try {
        const app = await NestFactory.createApplicationContext(DebugModule);
        console.log('Module Loaded!');
        const usersService = app.get(UsersService);
        console.log('UsersService found:', !!usersService);
        await app.close();
    } catch (e) {
        console.error('DI Failed:', e);
    }
}

debug();
