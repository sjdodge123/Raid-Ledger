import { Inject, Injectable } from '@nestjs/common';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../drizzle/schema';
import { eq } from 'drizzle-orm';

@Injectable()
export class UsersService {
    constructor(
        @Inject(DrizzleAsyncProvider)
        private db: PostgresJsDatabase<typeof schema>,
    ) { }

    async findByDiscordId(discordId: string) {
        const result = await this.db.query.users.findFirst({
            where: eq(schema.users.discordId, discordId),
        });
        return result;
    }

    async createOrUpdate(profile: { discordId: string; username: string; avatar?: string }) {
        const existing = await this.findByDiscordId(profile.discordId);

        if (existing) {
            const [updated] = await this.db
                .update(schema.users)
                .set({
                    username: profile.username,
                    avatar: profile.avatar,
                    updatedAt: new Date(),
                })
                .where(eq(schema.users.discordId, profile.discordId))
                .returning();
            return updated;
        }

        const [created] = await this.db.insert(schema.users).values({
            discordId: profile.discordId,
            username: profile.username,
            avatar: profile.avatar,
        }).returning();

        return created;
    }

    async findById(id: number) {
        return this.db.query.users.findFirst({
            where: eq(schema.users.id, id),
        });
    }

    async setAdminStatus(discordId: string, isAdmin: boolean) {
        const [updated] = await this.db
            .update(schema.users)
            .set({ isAdmin, updatedAt: new Date() })
            .where(eq(schema.users.discordId, discordId))
            .returning();
        return updated;
    }
}
