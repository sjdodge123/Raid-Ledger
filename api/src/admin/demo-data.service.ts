import { Injectable, Inject, Logger } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../drizzle/schema';
import { DrizzleAsyncProvider } from '../drizzle/drizzle.module';
import { SettingsService } from '../settings/settings.service';
import {
  DemoDataStatusDto,
  DemoDataResultDto,
  DemoDataCountsDto,
} from '@raid-ledger/contract';
import {
  DEMO_USERNAMES,
  FAKE_GAMERS,
  CHARACTERS_CONFIG,
  THEME_ASSIGNMENTS,
  ROLE_ACCOUNTS,
  DEMO_NOTIFICATION_TITLES,
  getClassIconUrl,
  getGameTimeDefinitions,
  getAvailabilityDefinitions,
  getEventsDefinitions,
  getNotificationTemplates,
} from './demo-data.constants';

@Injectable()
export class DemoDataService {
  private readonly logger = new Logger(DemoDataService.name);

  constructor(
    @Inject(DrizzleAsyncProvider)
    private db: PostgresJsDatabase<typeof schema>,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Get current demo data status with entity counts.
   */
  async getStatus(): Promise<DemoDataStatusDto> {
    const demoMode = await this.settingsService.getDemoMode();
    const counts = await this.getCounts();
    return { demoMode, ...counts };
  }

  /**
   * Install all demo data. Aborts if demo data already exists.
   */
  async installDemoData(): Promise<DemoDataResultDto> {
    // Check if demo data already exists
    const existing = await this.getCounts();
    if (existing.users > 0) {
      return {
        success: false,
        message:
          'Demo data already exists. Delete it first before reinstalling.',
        counts: existing,
      };
    }

    this.logger.log('Installing demo data...');

    try {
      // 1. Create SeedAdmin user
      const [seedAdmin] = await this.db
        .insert(schema.users)
        .values({ username: 'SeedAdmin', isAdmin: true })
        .returning();

      // 2. Create fake gamer users
      const createdUsers: (typeof schema.users.$inferSelect)[] = [seedAdmin];
      for (const gamer of FAKE_GAMERS) {
        const [user] = await this.db
          .insert(schema.users)
          .values({
            username: gamer.username,
            avatar: gamer.avatar,
            isAdmin: false,
          })
          .returning();
        createdUsers.push(user);
      }

      // 3. Look up game registry entries
      const registryGames = await this.db
        .select()
        .from(schema.gameRegistry)
        .limit(3);

      // 4. Create events
      const eventDefs = getEventsDefinitions(registryGames);
      const createdEvents: (typeof schema.events.$inferSelect)[] = [];

      for (const eventData of eventDefs) {
        const { startTime, endTime, ...rest } = eventData;
        const [event] = await this.db
          .insert(schema.events)
          .values({
            ...rest,
            creatorId: seedAdmin.id,
            duration: [startTime, endTime],
          })
          .returning();
        createdEvents.push(event);
      }

      // 5. Create characters
      let charactersCreated = 0;
      if (registryGames.length > 0) {
        const usersWithMain = new Set<string>();

        for (const charData of CHARACTERS_CONFIG) {
          const user = createdUsers.find(
            (u) => u.username === charData.username,
          );
          const game = registryGames[charData.gameIdx];
          if (!user || !game) continue;

          const isMain = !usersWithMain.has(charData.username);
          usersWithMain.add(charData.username);

          await this.db.insert(schema.characters).values({
            userId: user.id,
            gameId: game.id,
            name: charData.charName,
            class: charData.class,
            spec: charData.spec,
            role: charData.role,
            isMain,
            avatarUrl: getClassIconUrl(charData.wowClass),
            displayOrder: isMain ? 0 : 1,
          });
          charactersCreated++;
        }
      }

      // 6. Create event signups (3-5 random users per event)
      let signupsCreated = 0;
      const allCharacters = await this.db
        .select()
        .from(schema.characters)
        .where(
          inArray(
            schema.characters.userId,
            createdUsers.map((u) => u.id),
          ),
        );

      for (const event of createdEvents) {
        const numSignups = Math.floor(Math.random() * 3) + 3;
        // Skip SeedAdmin (index 0) for signups
        const gamers = createdUsers.slice(1);
        const shuffled = [...gamers].sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, numSignups);

        for (const user of selected) {
          const userChar = event.registryGameId
            ? allCharacters.find(
                (c) =>
                  c.userId === user.id && c.gameId === event.registryGameId,
              )
            : undefined;

          await this.db.insert(schema.eventSignups).values({
            eventId: event.id,
            userId: user.id,
            characterId: userChar?.id ?? null,
            confirmationStatus: userChar ? 'confirmed' : 'pending',
          });
          signupsCreated++;
        }
      }

      // 7. Create availability records
      let availabilityCreated = 0;
      const availDefs = getAvailabilityDefinitions();
      for (const avail of availDefs) {
        const user = createdUsers.find((u) => u.username === avail.username);
        if (!user) continue;

        await this.db.insert(schema.availability).values({
          userId: user.id,
          timeRange: [avail.start, avail.end],
          status: avail.status,
        });
        availabilityCreated++;
      }

      // 8. Create game time templates
      const gameTimeDefs = getGameTimeDefinitions();
      const gameTimeValues = gameTimeDefs
        .map((slot) => {
          const user = createdUsers.find((u) => u.username === slot.username);
          if (!user) return null;
          return {
            userId: user.id,
            dayOfWeek: slot.dayOfWeek,
            startHour: slot.startHour,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      if (gameTimeValues.length > 0) {
        await this.db
          .insert(schema.gameTimeTemplates)
          .values(gameTimeValues)
          .onConflictDoNothing();
      }

      // 9. Set theme preferences
      for (const [username, theme] of Object.entries(THEME_ASSIGNMENTS)) {
        const user = createdUsers.find((u) => u.username === username);
        if (!user) continue;

        await this.db
          .insert(schema.userPreferences)
          .values({ userId: user.id, key: 'theme', value: theme })
          .onConflictDoNothing();
      }

      // 10. Reassign first 2 events to ShadowMage (raid leader role)
      const raidLeader = createdUsers.find(
        (u) => u.username === ROLE_ACCOUNTS[0].username,
      );
      if (raidLeader && createdEvents.length >= 2) {
        for (const event of createdEvents.slice(0, 2)) {
          await this.db
            .update(schema.events)
            .set({ creatorId: raidLeader.id })
            .where(eq(schema.events.id, event.id));
        }
      }

      // 11. Create notifications for admin user
      const [adminUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, 'roknua'))
        .limit(1);

      let notificationsCreated = 0;
      if (adminUser) {
        const notifTemplates = getNotificationTemplates(
          adminUser.id,
          createdEvents,
          createdUsers.slice(1),
        );
        for (const notif of notifTemplates) {
          await this.db.insert(schema.notifications).values(notif);
          notificationsCreated++;
        }
      }

      // 12. Create notification preferences for demo users
      for (const user of createdUsers) {
        await this.db
          .insert(schema.userNotificationPreferences)
          .values({ userId: user.id })
          .onConflictDoNothing();
      }

      // 13. Set demo_mode = true
      await this.settingsService.setDemoMode(true);

      const counts: DemoDataCountsDto = {
        users: createdUsers.length,
        events: createdEvents.length,
        characters: charactersCreated,
        signups: signupsCreated,
        availability: availabilityCreated,
        gameTimeSlots: gameTimeValues.length,
        notifications: notificationsCreated,
      };

      this.logger.log(`Demo data installed: ${JSON.stringify(counts)}`);

      return {
        success: true,
        message: `Demo data installed: ${counts.users} users, ${counts.events} events, ${counts.characters} characters`,
        counts,
      };
    } catch (error) {
      this.logger.error('Failed to install demo data:', error);
      // Attempt cleanup on failure
      try {
        await this.clearDemoData();
      } catch {
        // Best-effort cleanup
      }
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : 'Failed to install demo data',
        counts: {
          users: 0,
          events: 0,
          characters: 0,
          signups: 0,
          availability: 0,
          gameTimeSlots: 0,
          notifications: 0,
        },
      };
    }
  }

  /**
   * Delete all demo data in FK-constraint-safe order.
   */
  async clearDemoData(): Promise<DemoDataResultDto> {
    this.logger.log('Clearing demo data...');

    try {
      // Get demo user IDs
      const demoUsers = await this.db
        .select({ id: schema.users.id })
        .from(schema.users)
        .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));

      const demoUserIds = demoUsers.map((u) => u.id);

      // Count before deletion for reporting
      const countsBefore = await this.getCounts();

      if (demoUserIds.length > 0) {
        // Get event IDs created by demo users (before deleting)
        const demoEvents = await this.db
          .select({ id: schema.events.id })
          .from(schema.events)
          .where(inArray(schema.events.creatorId, demoUserIds));
        const demoEventIds = demoEvents.map((e) => e.id);

        // 1. Null out availability.sourceEventId where it points to demo events
        if (demoEventIds.length > 0) {
          await this.db
            .update(schema.availability)
            .set({ sourceEventId: null })
            .where(inArray(schema.availability.sourceEventId, demoEventIds));
        }

        // 2. Delete availability for demo users
        await this.db
          .delete(schema.availability)
          .where(inArray(schema.availability.userId, demoUserIds));

        // 3. Delete sessions for demo users
        await this.db
          .delete(schema.sessions)
          .where(inArray(schema.sessions.userId, demoUserIds));

        // 4. Delete local_credentials for demo users
        await this.db
          .delete(schema.localCredentials)
          .where(inArray(schema.localCredentials.userId, demoUserIds));

        // 5. Delete events created by demo users (cascades: event_signups, roster_assignments)
        if (demoEventIds.length > 0) {
          await this.db
            .delete(schema.events)
            .where(inArray(schema.events.id, demoEventIds));
        }

        // 6. Delete demo users (cascades: characters, game_time_templates,
        //    game_time_overrides, notifications, user_notification_preferences,
        //    user_preferences, game_interests)
        await this.db
          .delete(schema.users)
          .where(inArray(schema.users.id, demoUserIds));
      }

      // 7. Delete admin-targeted demo notifications by title match
      await this.db
        .delete(schema.notifications)
        .where(
          inArray(schema.notifications.title, [
            ...DEMO_NOTIFICATION_TITLES,
          ] as string[]),
        );

      // 8. Set demo_mode = false
      await this.settingsService.setDemoMode(false);

      this.logger.log(`Demo data cleared: ${JSON.stringify(countsBefore)}`);

      return {
        success: true,
        message: `Demo data deleted: ${countsBefore.users} users, ${countsBefore.events} events removed`,
        counts: countsBefore,
      };
    } catch (error) {
      this.logger.error('Failed to clear demo data:', error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : 'Failed to clear demo data',
        counts: {
          users: 0,
          events: 0,
          characters: 0,
          signups: 0,
          availability: 0,
          gameTimeSlots: 0,
          notifications: 0,
        },
      };
    }
  }

  /**
   * Count demo entities by querying for DEMO_USERNAMES.
   */
  private async getCounts(): Promise<DemoDataCountsDto> {
    const demoUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));

    const demoUserIds = demoUsers.map((u) => u.id);

    if (demoUserIds.length === 0) {
      return {
        users: 0,
        events: 0,
        characters: 0,
        signups: 0,
        availability: 0,
        gameTimeSlots: 0,
        notifications: 0,
      };
    }

    const [
      eventsCount,
      charsCount,
      signupsCount,
      availCount,
      gtCount,
      notifsCount,
    ] = await Promise.all([
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.events)
        .where(inArray(schema.events.creatorId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.characters)
        .where(inArray(schema.characters.userId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.eventSignups)
        .where(inArray(schema.eventSignups.userId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.availability)
        .where(inArray(schema.availability.userId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.gameTimeTemplates)
        .where(inArray(schema.gameTimeTemplates.userId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.notifications)
        .where(inArray(schema.notifications.userId, demoUserIds))
        .then((r) => r[0]?.count ?? 0),
    ]);

    return {
      users: demoUserIds.length,
      events: eventsCount,
      characters: charsCount,
      signups: signupsCount,
      availability: availCount,
      gameTimeSlots: gtCount,
      notifications: notifsCount,
    };
  }
}
