import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/auth.service';
import { UsersService } from '../src/users/users.service';
import * as dotenv from 'dotenv';
dotenv.config();

console.log('Env Check:', { db: !!process.env.DATABASE_URL, jwt: !!process.env.JWT_SECRET });

async function verifyAuth() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const authService = app.get(AuthService);
    const usersService = app.get(UsersService);

    console.log('Verifying Auth Flow...');

    // 1. Simulate Discord Validation
    const discordProfile = { id: 'test-discord-id', username: 'TestUser', avatar: 'avatar-hash' };
    console.log('Simulating Discord Login:', discordProfile);

    const user = await authService.validateDiscordUser(
        discordProfile.id,
        discordProfile.username,
        discordProfile.avatar
    );

    if (!user || user.discordId !== discordProfile.id) {
        throw new Error('User validation failed');
    }
    console.log('User Validated:', user);

    // 2. Simulate Login (Token Generation)
    const loginResult = await authService.login(user);
    if (!loginResult.access_token) {
        throw new Error('Token generation failed');
    }
    console.log('JWT Generated:', loginResult.access_token);

    console.log('✅ Auth verification successful!');
    await app.close();
}

verifyAuth().catch(err => {
    console.error('❌ Verification failed:', err);
    process.exit(1);
});
