/* eslint-disable */
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
  ORIGINAL_GAMER_COUNT,
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
import {
  createRng,
  generateEvents,
  generateCharacters,
  generateSignups,
  generateGameTime,
  generateAvailability,
  generateNotifications,
  generateNotifPreferences,
  generateGameInterests,
} from './demo-data-generator';

const BATCH_SIZE = 500;

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
   * Insert rows in batches to avoid hitting parameter limits.
   *
   * Note: uses `as never` to satisfy Drizzle's complex table-specific insert
   * types. Callers should type their values arrays using `$inferInsert` types
   * (e.g. `typeof schema.users.$inferInsert`) for compile-time safety.
   */
  private async batchInsert(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
    onConflict?: 'doNothing',
  ): Promise<void> {
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const q = this.db.insert(table).values(batch as never);
      if (onConflict === 'doNothing') {
        await q.onConflictDoNothing();
      } else {
        await q;
      }
    }
  }

  /**
   * Insert rows in batches, returning all inserted rows.
   * Cast the return value to the appropriate `$inferSelect` type at call sites.
   */
  private async batchInsertReturning(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const inserted = await this.db
        .insert(table)
        .values(batch as never)
        .returning();
      results.push(...inserted);
    }
    return results;
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

    this.logger.log('Installing demo data (~100 users)...');

    try {
      const rng = createRng();
      const now = new Date();

      // ── 1. Create SeedAdmin ──────────────────────────────────────────
      const [seedAdmin] = await this.db
        .insert(schema.users)
        .values({ username: 'SeedAdmin', role: 'admin' })
        .returning();

      // ── 2. Batch insert fake gamers (~100 users) ─────────────────────
      const gamerValues = FAKE_GAMERS.map((g) => ({
        username: g.username,
        avatar: g.avatar,
        role: 'member' as const,
      }));
      const insertedGamers = (await this.batchInsertReturning(
        schema.users,
        gamerValues,
      )) as (typeof schema.users.$inferSelect)[];
      const allUsers = [seedAdmin, ...insertedGamers];

      // Build username → userId map
      const userByName = new Map(allUsers.map((u) => [u.username, u]));

      // ── 3. Look up games (all entries) ─────────────────────────────
      const allGames = await this.db.select().from(schema.games);

      const gamesBySlug = new Map(allGames.map((g) => [g.slug, g]));
      const igdbIdsByDbId = new Map(allGames.map((g) => [g.igdbId, g.id]));

      // ── 5. Generate all data ─────────────────────────────────────────
      // Build IGDB ID → max player count map for realistic event sizing
      const igdbPlayerCounts = new Map<string, number>();
      for (const g of allGames) {
        const pc = g.playerCount as { min: number; max: number } | null;
        if (pc?.max) {
          igdbPlayerCounts.set(String(g.igdbId), pc.max);
        }
      }

      const generatedEvents = generateEvents(
        rng,
        allGames,
        now,
        igdbPlayerCounts,
      );
      const generatedUsernames = FAKE_GAMERS.map((g) => g.username);
      // Only generate characters for new users (originals have CHARACTERS_CONFIG)
      const newUsernames = generatedUsernames.slice(ORIGINAL_GAMER_COUNT);
      const generatedChars = generateCharacters(rng, newUsernames);
      const generatedSignups = generateSignups(
        rng,
        generatedEvents,
        [...generatedUsernames, 'SeedAdmin'],
        generatedChars,
      );
      const generatedGameTime = generateGameTime(
        rng,
        newUsernames, // originals have hand-crafted game time
      );
      const generatedAvail = generateAvailability(rng, newUsernames, now);
      const generatedNotifs = generateNotifications(
        rng,
        generatedUsernames,
        generatedEvents,
        now,
      );
      const generatedNotifPrefs = generateNotifPreferences(
        rng,
        generatedUsernames,
      );
      const allIgdbIds = allGames.map((g) => g.igdbId).filter((id): id is number => id !== null);
      const generatedInterests = generateGameInterests(
        rng,
        generatedUsernames,
        allIgdbIds,
      );

      // ── 6. Insert original hand-crafted events ──────────────────────
      const origEventDefs = getEventsDefinitions(allGames);
      const origEventValues = origEventDefs.map((e) => ({
        title: e.title,
        description: e.description,
        gameId: e.gameId,
        creatorId: seedAdmin.id,
        duration: [e.startTime, e.endTime] as [Date, Date],
      }));

      // ── 7. Insert generated events ──────────────────────────────────
      const genEventValues = generatedEvents.map((e) => ({
        title: e.title,
        description: e.description,
        gameId: e.gameId,
        creatorId: seedAdmin.id,
        duration: [e.startTime, e.endTime] as [Date, Date],
        maxAttendees: e.maxPlayers,
      }));

      const allEventValues = [...origEventValues, ...genEventValues];
      const createdEvents = (await this.batchInsertReturning(
        schema.events,
        allEventValues,
      )) as (typeof schema.events.$inferSelect)[];

      // Split into original vs generated events
      const origEventCount = origEventDefs.length;
      const origEvents = createdEvents.slice(0, origEventCount);
      const genEvents = createdEvents.slice(origEventCount);

      // ── 8. Insert original hand-crafted characters ──────────────────
      const usersWithMain = new Set<string>();
      const origCharValues: Record<string, unknown>[] = [];
      for (const charData of CHARACTERS_CONFIG) {
        const user = userByName.get(charData.username);
        const game = allGames[charData.gameIdx];
        if (!user || !game) continue;

        const isMain = !usersWithMain.has(`${charData.username}:${game.id}`);
        usersWithMain.add(`${charData.username}:${game.id}`);

        origCharValues.push({
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
      }

      // ── 9. Insert generated characters ──────────────────────────────
      const genCharValues: Record<string, unknown>[] = [];
      for (const c of generatedChars) {
        const user = userByName.get(c.username);
        const game = gamesBySlug.get(c.gameSlug);
        if (!user || !game) continue;

        genCharValues.push({
          userId: user.id,
          gameId: game.id,
          name: c.charName,
          class: c.class,
          spec: c.spec,
          role: c.role,
          isMain: c.isMain,
          avatarUrl: c.wowClass ? getClassIconUrl(c.wowClass) : null,
          displayOrder: c.isMain ? 0 : 1,
        });
      }

      const allCharValues = [...origCharValues, ...genCharValues];
      const createdChars = (await this.batchInsertReturning(
        schema.characters,
        allCharValues,
      )) as (typeof schema.characters.$inferSelect)[];

      // Build char lookup: (userId, gameId) → characterId
      const charByUserGame = new Map<string, string>();
      for (const c of createdChars) {
        const key = `${c.userId}:${c.gameId}`;
        // Keep the main character for each user+game combo
        if (!charByUserGame.has(key) || c.isMain) {
          charByUserGame.set(key, c.id);
        }
      }

      // ── 10. Insert original event signups ───────────────────────────
      const origSignupValues: Record<string, unknown>[] = [];
      for (const event of origEvents) {
        const eventRng = createRng(event.id);
        const numSignups = 3 + Math.floor(eventRng() * 3);
        const gamers = allUsers.slice(1); // skip SeedAdmin
        const shuffled = [...gamers];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(eventRng() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        const selected = shuffled.slice(0, numSignups);

        for (const user of selected) {
          const charKey = event.gameId
            ? `${user.id}:${event.gameId}`
            : null;
          const characterId = charKey
            ? (charByUserGame.get(charKey) ?? null)
            : null;

          origSignupValues.push({
            eventId: event.id,
            userId: user.id,
            characterId,
            confirmationStatus: characterId ? 'confirmed' : 'pending',
          });
        }
      }

      // ── 11. Insert generated event signups ──────────────────────────
      const genSignupValues: Record<string, unknown>[] = [];
      for (const signup of generatedSignups) {
        const event = genEvents[signup.eventIdx];
        const user = userByName.get(signup.username);
        if (!event || !user) continue;

        const charKey = event.gameId
          ? `${user.id}:${event.gameId}`
          : null;
        const characterId = charKey
          ? (charByUserGame.get(charKey) ?? null)
          : null;

        genSignupValues.push({
          eventId: event.id,
          userId: user.id,
          characterId,
          confirmationStatus: characterId ? 'confirmed' : 'pending',
        });
      }

      const allSignupValues = [...origSignupValues, ...genSignupValues];

      // Dedupe signups by eventId+userId (generator may produce duplicates)
      const signupDeduped = new Map<string, Record<string, unknown>>();
      for (const s of allSignupValues) {
        const key = `${s.eventId}:${s.userId}`;
        if (!signupDeduped.has(key)) {
          signupDeduped.set(key, s);
        }
      }
      const uniqueSignups = [...signupDeduped.values()];

      const createdSignups = (await this.batchInsertReturning(
        schema.eventSignups,
        uniqueSignups,
      )) as (typeof schema.eventSignups.$inferSelect)[];

      // ── 12. Insert roster assignments ───────────────────────────────
      // Auto-slot ALL signups into roster positions.
      // MMO events: use character role (tank/healer/dps).
      // Generic events: use 'player' role, bench overflow beyond maxAttendees.
      const rosterValues: Record<string, unknown>[] = [];
      const charById = new Map(createdChars.map((c) => [c.id, c]));

      // Build event maxAttendees lookup from generated events
      const eventMaxAttendees = new Map<number, number | null>();
      for (let i = 0; i < generatedEvents.length; i++) {
        const dbEvent = genEvents[i];
        if (dbEvent) {
          eventMaxAttendees.set(dbEvent.id, generatedEvents[i].maxPlayers);
        }
      }

      // Determine which games are MMOs (genre 36)
      const mmoGameIds = new Set<number>();
      for (const g of allGames) {
        const genres = (g.genres as number[]) ?? [];
        if (genres.includes(36)) {
          mmoGameIds.add(g.id);
        }
      }
      // Build event → gameId lookup
      const eventGameId = new Map<number, number | null>();
      for (const ev of createdEvents) {
        eventGameId.set(ev.id, ev.gameId);
      }

      // Group signups by eventId
      const signupsByEvent = new Map<number, typeof createdSignups>();
      for (const signup of createdSignups) {
        const list = signupsByEvent.get(signup.eventId) ?? [];
        list.push(signup);
        signupsByEvent.set(signup.eventId, list);
      }

      // Track next position per (eventId, role) to satisfy unique_slot_per_event
      const slotCounter = new Map<string, number>();

      for (const [eventId, signups] of signupsByEvent) {
        const gId = eventGameId.get(eventId);
        const isMMO = gId ? mmoGameIds.has(gId) : false;
        const maxPlayers = eventMaxAttendees.get(eventId) ?? null;
        let playerCount = 0;

        for (const signup of signups) {
          let role: string;

          if (isMMO) {
            // MMO: use character role or default to dps
            const char = signup.characterId
              ? charById.get(signup.characterId)
              : null;
            role = char?.role ?? 'dps';
          } else {
            // Generic game: slot into 'player', overflow to 'bench'
            if (maxPlayers && playerCount >= maxPlayers) {
              role = 'bench';
            } else {
              role = 'player';
              playerCount++;
            }
          }

          const slotKey = `${eventId}:${role}`;
          const position = (slotCounter.get(slotKey) ?? 0) + 1;
          slotCounter.set(slotKey, position);

          rosterValues.push({
            eventId: signup.eventId,
            signupId: signup.id,
            role,
            position,
          });
        }
      }

      if (rosterValues.length > 0) {
        await this.batchInsert(schema.rosterAssignments, rosterValues);
      }

      // ── 13. Insert availability ─────────────────────────────────────
      // Original availability
      const origAvailDefs = getAvailabilityDefinitions();
      const origAvailValues = origAvailDefs
        .map((a) => {
          const user = userByName.get(a.username);
          if (!user) return null;
          return {
            userId: user.id,
            timeRange: [a.start, a.end] as [Date, Date],
            status: a.status,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      // Generated availability
      const genAvailValues = generatedAvail
        .map((a) => {
          const user = userByName.get(a.username);
          if (!user) return null;
          return {
            userId: user.id,
            timeRange: [a.start, a.end] as [Date, Date],
            status: a.status,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      const allAvailValues = [...origAvailValues, ...genAvailValues];
      if (allAvailValues.length > 0) {
        await this.batchInsert(schema.availability, allAvailValues);
      }

      // ── 14. Insert game time templates ──────────────────────────────
      // Original game time
      const origGameTimeDefs = getGameTimeDefinitions();
      const origGameTimeValues = origGameTimeDefs
        .map((slot) => {
          const user = userByName.get(slot.username);
          if (!user) return null;
          return {
            userId: user.id,
            dayOfWeek: slot.dayOfWeek,
            startHour: slot.startHour,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      // Generated game time
      const genGameTimeValues = generatedGameTime
        .map((slot) => {
          const user = userByName.get(slot.username);
          if (!user) return null;
          return {
            userId: user.id,
            dayOfWeek: slot.dayOfWeek,
            startHour: slot.startHour,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      const allGameTimeValues = [...origGameTimeValues, ...genGameTimeValues];

      // Dedupe game time by userId+dayOfWeek+startHour
      const gtDeduped = new Map<string, (typeof allGameTimeValues)[0]>();
      for (const gt of allGameTimeValues) {
        const key = `${gt.userId}:${gt.dayOfWeek}:${gt.startHour}`;
        gtDeduped.set(key, gt);
      }
      const uniqueGameTime = [...gtDeduped.values()];

      if (uniqueGameTime.length > 0) {
        await this.batchInsert(
          schema.gameTimeTemplates,
          uniqueGameTime,
          'doNothing',
        );
      }

      // ── 15. Insert notifications ────────────────────────────────────
      // Original admin notifications
      const [adminUser] = await this.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, 'roknua'))
        .limit(1);

      let notificationsCreated = 0;
      if (adminUser) {
        const notifTemplates = getNotificationTemplates(
          adminUser.id,
          origEvents,
          allUsers.slice(1),
        );
        if (notifTemplates.length > 0) {
          await this.batchInsert(schema.notifications, notifTemplates);
          notificationsCreated += notifTemplates.length;
        }
      }

      // Generated notifications for demo users
      const genNotifValues = generatedNotifs
        .map((n) => {
          const user = userByName.get(n.username);
          if (!user) return null;
          return {
            userId: user.id,
            type: n.type,
            title: n.title,
            message: n.message,
            payload: n.payload,
            createdAt: n.createdAt,
            readAt: n.readAt,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      if (genNotifValues.length > 0) {
        await this.batchInsert(schema.notifications, genNotifValues);
        notificationsCreated += genNotifValues.length;
      }

      // ── 16. Insert notification preferences ─────────────────────────
      const prefsByUsername = new Map(
        generatedNotifPrefs.map((p) => [p.username, p.channelPrefs]),
      );
      const notifPrefValues = allUsers.map((u) => {
        const customPrefs = prefsByUsername.get(u.username);
        if (customPrefs) {
          return {
            userId: u.id,
            channelPrefs: customPrefs as unknown as schema.ChannelPrefs,
          };
        }
        return { userId: u.id };
      });
      await this.batchInsert(
        schema.userNotificationPreferences,
        notifPrefValues,
        'doNothing',
      );

      // ── 17. Insert user preferences (themes) ───────────────────────
      const themePrefValues: Record<string, unknown>[] = [];
      for (const [username, theme] of Object.entries(THEME_ASSIGNMENTS)) {
        const user = userByName.get(username);
        if (user) {
          themePrefValues.push({
            userId: user.id,
            key: 'theme',
            value: theme,
          });
        }
      }

      // Generated users get random themes
      const themes = ['default-dark', 'default-light', 'auto'];
      const themeRng = createRng(0xc0101);
      for (const gamer of FAKE_GAMERS.slice(ORIGINAL_GAMER_COUNT)) {
        const user = userByName.get(gamer.username);
        if (user) {
          const theme = themes[Math.floor(themeRng() * themes.length)];
          themePrefValues.push({
            userId: user.id,
            key: 'theme',
            value: theme,
          });
        }
      }

      if (themePrefValues.length > 0) {
        await this.batchInsert(
          schema.userPreferences,
          themePrefValues,
          'doNothing',
        );
      }

      // ── 18. Insert game interests ───────────────────────────────────
      const interestValues = generatedInterests
        .map((gi) => {
          const user = userByName.get(gi.username);
          const gameDbId = igdbIdsByDbId.get(gi.igdbId);
          if (!user || !gameDbId) return null;
          return { userId: user.id, gameId: gameDbId };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      // Dedupe interests
      const interestDeduped = new Map<string, (typeof interestValues)[0]>();
      for (const gi of interestValues) {
        const key = `${gi.userId}:${gi.gameId}`;
        interestDeduped.set(key, gi);
      }
      const uniqueInterests = [...interestDeduped.values()];

      if (uniqueInterests.length > 0) {
        await this.batchInsert(
          schema.gameInterests,
          uniqueInterests,
          'doNothing',
        );
      }

      // ── 19. Reassign some events to non-admin creators ─────────────
      const raidLeader = userByName.get(ROLE_ACCOUNTS[0].username);
      if (raidLeader && origEvents.length >= 2) {
        for (const event of origEvents.slice(0, 2)) {
          await this.db
            .update(schema.events)
            .set({ creatorId: raidLeader.id })
            .where(eq(schema.events.id, event.id));
        }
      }

      // Reassign ~30% of generated events to random non-admin users
      const eventReassignRng = createRng(0xeee);
      const nonAdminUsers = allUsers.filter((u) => u.role !== 'admin');
      if (nonAdminUsers.length > 0) {
        const reassignByCreator = new Map<number, number[]>();
        for (const event of genEvents) {
          if (eventReassignRng() < 0.3) {
            const creator =
              nonAdminUsers[
                Math.floor(eventReassignRng() * nonAdminUsers.length)
              ];
            const ids = reassignByCreator.get(creator.id) ?? [];
            ids.push(event.id);
            reassignByCreator.set(creator.id, ids);
          }
        }
        for (const [creatorId, eventIds] of reassignByCreator) {
          await this.db
            .update(schema.events)
            .set({ creatorId })
            .where(inArray(schema.events.id, eventIds));
        }
      }

      // ── 20. Set demo_mode = true ────────────────────────────────────
      await this.settingsService.setDemoMode(true);

      const counts: DemoDataCountsDto = {
        users: allUsers.length,
        events: createdEvents.length,
        characters: createdChars.length,
        signups: createdSignups.length,
        availability: allAvailValues.length,
        gameTimeSlots: uniqueGameTime.length,
        notifications: notificationsCreated,
      };

      this.logger.log('Demo data installed');
      this.logger.debug(`Demo data counts: ${JSON.stringify(counts)}`);

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

      this.logger.log('Demo data cleared');
      this.logger.debug(
        `Demo data counts before clear: ${JSON.stringify(countsBefore)}`,
      );

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
