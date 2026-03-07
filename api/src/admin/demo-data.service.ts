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

/** Deduplicate an array by a key function, keeping first occurrence. */
function dedupeByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    const k = keyFn(item);
    if (!seen.has(k)) seen.set(k, item);
  }
  return [...seen.values()];
}

/** Group an array by a key function. */
function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K,
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

/** Build event-to-maxAttendees map from generated events. */
function buildMaxAttendeesMap(
  genEvents: { id: number }[],
  generatedEvents: { maxPlayers: number | null }[],
): Map<number, number | null> {
  const map = new Map<number, number | null>();
  for (let i = 0; i < generatedEvents.length; i++) {
    const dbEvent = genEvents[i];
    if (dbEvent) map.set(dbEvent.id, generatedEvents[i].maxPlayers);
  }
  return map;
}

/** Build set of MMO game IDs (genre 36). */
function buildMmoGameIdSet(
  allGames: { id: number; genres: unknown }[],
): Set<number> {
  const set = new Set<number>();
  for (const g of allGames) {
    if (((g.genres as number[]) ?? []).includes(36)) set.add(g.id);
  }
  return set;
}

/** Type guard for filtering out nulls. */
function nonNull<T>(v: T | null): v is T {
  return v !== null;
}

/** Map a game-time slot to a DB-ready value using the user map. */
function mapGameTimeSlot(userByName: Map<string, { id: number }>) {
  return (slot: { username: string; dayOfWeek: number; startHour: number }) => {
    const user = userByName.get(slot.username);
    if (!user) return null;
    return {
      userId: user.id,
      dayOfWeek: slot.dayOfWeek,
      startHour: slot.startHour,
    };
  };
}

function emptyCounts(): DemoDataCountsDto {
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
      const counts = await this.performInstall();
      this.logger.log('Demo data installed');
      this.logger.debug(`Demo data counts: ${JSON.stringify(counts)}`);
      return this.buildInstallResult(true, counts);
    } catch (error) {
      this.logger.error('Failed to install demo data:', error);
      try {
        await this.clearDemoData();
      } catch {
        /* Best-effort */
      }
      return this.buildInstallResult(false, emptyCounts(), error);
    }
  }

  private buildInstallResult(
    success: boolean,
    counts: DemoDataCountsDto,
    error?: unknown,
  ): DemoDataResultDto {
    const message = success
      ? `Demo data installed: ${counts.users} users, ${counts.events} events, ${counts.characters} characters`
      : error instanceof Error
        ? error.message
        : 'Failed to install demo data';
    return { success, message, counts };
  }

  /** Core install orchestrator — broken into phases for readability. */
  private async performInstall(): Promise<DemoDataCountsDto> {
    const rng = createRng();
    const now = new Date();
    const { allUsers, userByName } = await this.installUsers();
    const allGames = await this.db.select().from(schema.games);
    const generated = this.generateAllData(rng, allGames, now);

    const coreResult = await this.installCoreEntities(
      allUsers,
      userByName,
      allGames,
      generated,
    );
    const secondaryResult = await this.installSecondaryEntities(
      allUsers,
      userByName,
      allGames,
      generated,
    );
    await this.settingsService.setDemoMode(true);

    return {
      users: allUsers.length,
      ...coreResult,
      ...secondaryResult,
    };
  }

  /** Install events, characters, signups, and roster assignments. */
  private async installCoreEntities(
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    generated: ReturnType<DemoDataService['generateAllData']>,
  ) {
    const gamesBySlug = new Map(allGames.map((g) => [g.slug, g]));
    const eventsResult = await this.installEvents(
      allUsers[0].id,
      allGames,
      generated.events,
    );
    const charsResult = await this.installCharacters(
      userByName,
      allGames,
      gamesBySlug,
      generated.chars,
    );
    return this.finishCoreInstall(
      eventsResult,
      charsResult,
      allUsers,
      userByName,
      allGames,
      generated,
    );
  }

  /** Complete core install: signups + roster. */
  private async installSignupsAndRoster(
    eventsResult: Awaited<ReturnType<DemoDataService['installEvents']>>,
    charsResult: Awaited<ReturnType<DemoDataService['installCharacters']>>,
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    generated: ReturnType<DemoDataService['generateAllData']>,
  ) {
    const { createdEvents, origEvents, genEvents } = eventsResult;
    const { createdSignups, uniqueSignups } = await this.installSignups(
      origEvents,
      genEvents,
      allUsers,
      userByName,
      charsResult.charByUserGame,
      generated.signups,
    );
    await this.installRosterAssignments(
      createdSignups,
      charsResult.createdChars,
      createdEvents,
      genEvents,
      generated.events,
      allGames,
    );
    return { createdEvents, origEvents, genEvents, uniqueSignups };
  }

  /** Finish core install: signups, roster, creator reassignment. */
  private async finishCoreInstall(
    eventsResult: Awaited<ReturnType<DemoDataService['installEvents']>>,
    charsResult: Awaited<ReturnType<DemoDataService['installCharacters']>>,
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    generated: ReturnType<DemoDataService['generateAllData']>,
  ) {
    const result = await this.installSignupsAndRoster(
      eventsResult,
      charsResult,
      allUsers,
      userByName,
      allGames,
      generated,
    );
    await this.reassignEventCreators(
      userByName,
      allUsers,
      result.origEvents,
      result.genEvents,
    );
    return {
      events: result.createdEvents.length,
      characters: charsResult.createdChars.length,
      signups: result.uniqueSignups.length,
    };
  }

  /** Install availability, game time, notifications, preferences, interests. */
  private async installSecondaryEntities(
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    generated: ReturnType<DemoDataService['generateAllData']>,
  ) {
    const igdbIdsByDbId = new Map(allGames.map((g) => [g.igdbId, g.id]));
    const origEvents = (await this.db.select().from(schema.events)).slice(0, 6);
    const counts = await this.installSecondaryData(
      allUsers,
      userByName,
      origEvents,
      generated,
    );
    await this.installPreferences(userByName, allUsers, generated.notifPrefs);
    await this.installGameInterests(
      userByName,
      igdbIdsByDbId,
      generated.interests,
    );
    return counts;
  }

  /** Install availability, game time, and notifications. */
  private async installSecondaryData(
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    origEvents: (typeof schema.events.$inferSelect)[],
    generated: ReturnType<DemoDataService['generateAllData']>,
  ) {
    const allAvailValues = await this.installAvailability(
      userByName,
      generated.avail,
    );
    const uniqueGameTime = await this.installGameTime(
      userByName,
      generated.gameTime,
    );
    const notifications = await this.installNotifications(
      userByName,
      allUsers,
      origEvents,
      generated.notifs,
    );
    return {
      availability: allAvailValues.length,
      gameTimeSlots: uniqueGameTime.length,
      notifications,
    };
  }

  /** Phase 1-2: Create SeedAdmin + fake gamers. */
  private async installUsers() {
    const [seedAdmin] = await this.db
      .insert(schema.users)
      .values({ username: 'SeedAdmin', role: 'admin' })
      .returning();
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
    const userByName = new Map(allUsers.map((u) => [u.username, u]));
    return { allUsers, userByName };
  }

  /** Build IGDB player count map from game rows. */
  private buildPlayerCountMap(
    allGames: (typeof schema.games.$inferSelect)[],
  ): Map<string, number> {
    const map = new Map<string, number>();
    for (const g of allGames) {
      const pc = g.playerCount as { min: number; max: number } | null;
      if (pc?.max) map.set(String(g.igdbId), pc.max);
    }
    return map;
  }

  /** Phase 5: Generate all data in memory. */
  private generateAllData(
    rng: () => number,
    allGames: (typeof schema.games.$inferSelect)[],
    now: Date,
  ) {
    const igdbPlayerCounts = this.buildPlayerCountMap(allGames);
    const events = generateEvents(rng, allGames, now, igdbPlayerCounts);
    const generatedUsernames = FAKE_GAMERS.map((g) => g.username);
    const newUsernames = generatedUsernames.slice(ORIGINAL_GAMER_COUNT);

    const chars = generateCharacters(rng, newUsernames);
    const allUsernames = [...generatedUsernames, 'SeedAdmin'];
    return {
      events,
      chars,
      signups: generateSignups(rng, events, allUsernames, chars, allGames),
      gameTime: generateGameTime(rng, newUsernames),
      avail: generateAvailability(rng, newUsernames, now),
      notifs: generateNotifications(rng, generatedUsernames, events, now),
      notifPrefs: generateNotifPreferences(rng, generatedUsernames),
      interests: generateGameInterests(
        rng,
        generatedUsernames,
        this.extractIgdbIds(allGames),
      ),
    };
  }

  /** Extract non-null IGDB IDs from games. */
  private extractIgdbIds(
    allGames: (typeof schema.games.$inferSelect)[],
  ): number[] {
    return allGames
      .map((g) => g.igdbId)
      .filter((id): id is number => id !== null);
  }

  /** Phase 6-7: Insert original + generated events. */
  private async installEvents(
    seedAdminId: number,
    allGames: (typeof schema.games.$inferSelect)[],
    generatedEvents: ReturnType<typeof generateEvents>,
  ) {
    const origEventDefs = getEventsDefinitions(allGames);
    const origEventValues = origEventDefs.map((e) => ({
      title: e.title,
      description: e.description,
      gameId: e.gameId,
      creatorId: seedAdminId,
      duration: [e.startTime, e.endTime] as [Date, Date],
    }));
    const genEventValues = generatedEvents.map((e) => ({
      title: e.title,
      description: e.description,
      gameId: e.gameId,
      creatorId: seedAdminId,
      duration: [e.startTime, e.endTime] as [Date, Date],
      maxAttendees: e.maxPlayers,
    }));
    const createdEvents = (await this.batchInsertReturning(schema.events, [
      ...origEventValues,
      ...genEventValues,
    ])) as (typeof schema.events.$inferSelect)[];
    const origEvents = createdEvents.slice(0, origEventDefs.length);
    const genEvents = createdEvents.slice(origEventDefs.length);
    return { createdEvents, origEvents, genEvents };
  }

  /** Phase 8-9: Insert original + generated characters. */
  private async installCharacters(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
    gamesBySlug: Map<string, typeof schema.games.$inferSelect>,
    generatedChars: ReturnType<typeof generateCharacters>,
  ) {
    const origCharValues = this.buildOriginalCharValues(userByName, allGames);
    const genCharValues = this.buildGeneratedCharValues(
      userByName,
      gamesBySlug,
      generatedChars,
    );
    const createdChars = (await this.batchInsertReturning(schema.characters, [
      ...origCharValues,
      ...genCharValues,
    ])) as (typeof schema.characters.$inferSelect)[];
    const charByUserGame = new Map<string, string>();
    for (const c of createdChars) {
      const key = `${c.userId}:${c.gameId}`;
      if (!charByUserGame.has(key) || c.isMain) charByUserGame.set(key, c.id);
    }
    return { createdChars, charByUserGame };
  }

  /** Build original hand-crafted character insert values. */
  private buildOriginalCharValues(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allGames: (typeof schema.games.$inferSelect)[],
  ): Record<string, unknown>[] {
    const usersWithMain = new Set<string>();
    const values: Record<string, unknown>[] = [];
    for (const charData of CHARACTERS_CONFIG) {
      const user = userByName.get(charData.username);
      const game = allGames[charData.gameIdx];
      if (!user || !game) continue;
      const isMain = !usersWithMain.has(`${charData.username}:${game.id}`);
      usersWithMain.add(`${charData.username}:${game.id}`);
      values.push({
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
    return values;
  }

  /** Build generated character insert values. */
  private buildGeneratedCharValues(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    gamesBySlug: Map<string, typeof schema.games.$inferSelect>,
    generatedChars: ReturnType<typeof generateCharacters>,
  ): Record<string, unknown>[] {
    const values: Record<string, unknown>[] = [];
    for (const c of generatedChars) {
      const user = userByName.get(c.username);
      const game = gamesBySlug.get(c.gameSlug);
      if (!user || !game) continue;
      values.push({
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
    return values;
  }

  /** Phase 10-11: Insert signups for original + generated events. */
  private async installSignups(
    origEvents: (typeof schema.events.$inferSelect)[],
    genEvents: (typeof schema.events.$inferSelect)[],
    allUsers: (typeof schema.users.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    charByUserGame: Map<string, string>,
    generatedSignups: ReturnType<typeof generateSignups>,
  ) {
    const origSignupValues = this.buildOrigSignupValues(
      origEvents,
      allUsers,
      charByUserGame,
    );
    const genSignupValues = this.buildGenSignupValues(
      genEvents,
      userByName,
      charByUserGame,
      generatedSignups,
    );
    const uniqueSignups = dedupeByKey(
      [...origSignupValues, ...genSignupValues],
      (s) => `${String(s.eventId)}:${String(s.userId)}`,
    );
    const createdSignups = (await this.batchInsertReturning(
      schema.eventSignups,
      uniqueSignups,
    )) as (typeof schema.eventSignups.$inferSelect)[];
    return { createdSignups, uniqueSignups };
  }

  /** Build original event signup values with random user selection. */
  private buildOrigSignupValues(
    origEvents: (typeof schema.events.$inferSelect)[],
    allUsers: (typeof schema.users.$inferSelect)[],
    charByUserGame: Map<string, string>,
  ): Record<string, unknown>[] {
    const values: Record<string, unknown>[] = [];
    for (const event of origEvents) {
      const eventRng = createRng(event.id);
      const numSignups = 3 + Math.floor(eventRng() * 3);
      const gamers = allUsers.slice(1);
      const shuffled = [...gamers];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(eventRng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (const user of shuffled.slice(0, numSignups)) {
        const charKey = event.gameId ? `${user.id}:${event.gameId}` : null;
        const characterId = charKey
          ? (charByUserGame.get(charKey) ?? null)
          : null;
        values.push({
          eventId: event.id,
          userId: user.id,
          characterId,
          confirmationStatus: characterId ? 'confirmed' : 'pending',
        });
      }
    }
    return values;
  }

  /** Build generated event signup values. */
  private buildGenSignupValues(
    genEvents: (typeof schema.events.$inferSelect)[],
    userByName: Map<string, typeof schema.users.$inferSelect>,
    charByUserGame: Map<string, string>,
    generatedSignups: ReturnType<typeof generateSignups>,
  ): Record<string, unknown>[] {
    const values: Record<string, unknown>[] = [];
    for (const signup of generatedSignups) {
      const event = genEvents[signup.eventIdx];
      const user = userByName.get(signup.username);
      if (!event || !user) continue;
      const charKey = event.gameId ? `${user.id}:${event.gameId}` : null;
      const characterId = charKey
        ? (charByUserGame.get(charKey) ?? null)
        : null;
      values.push({
        eventId: event.id,
        userId: user.id,
        characterId,
        confirmationStatus: characterId ? 'confirmed' : 'pending',
      });
    }
    return values;
  }

  /** Phase 12: Insert roster assignments for all signups. */
  private async installRosterAssignments(
    createdSignups: (typeof schema.eventSignups.$inferSelect)[],
    createdChars: (typeof schema.characters.$inferSelect)[],
    createdEvents: (typeof schema.events.$inferSelect)[],
    genEvents: (typeof schema.events.$inferSelect)[],
    generatedEvents: ReturnType<typeof generateEvents>,
    allGames: (typeof schema.games.$inferSelect)[],
  ): Promise<void> {
    const charById = new Map(createdChars.map((c) => [c.id, c]));
    const eventMaxAttendees = buildMaxAttendeesMap(genEvents, generatedEvents);
    const mmoGameIds = buildMmoGameIdSet(allGames);
    const eventGameId = new Map(createdEvents.map((ev) => [ev.id, ev.gameId]));
    const signupsByEvent = groupBy(createdSignups, (s) => s.eventId);
    const rosterValues = this.buildRosterValues(
      signupsByEvent,
      charById,
      eventGameId,
      mmoGameIds,
      eventMaxAttendees,
    );
    if (rosterValues.length > 0) {
      await this.batchInsert(schema.rosterAssignments, rosterValues);
    }
  }

  /** Build roster assignment values from signups. */
  private buildRosterValues(
    signupsByEvent: Map<number, (typeof schema.eventSignups.$inferSelect)[]>,
    charById: Map<string, typeof schema.characters.$inferSelect>,
    eventGameId: Map<number, number | null>,
    mmoGameIds: Set<number>,
    eventMaxAttendees: Map<number, number | null>,
  ): Record<string, unknown>[] {
    const values: Record<string, unknown>[] = [];
    const slotCounter = new Map<string, number>();
    for (const [eventId, signups] of signupsByEvent) {
      const gId = eventGameId.get(eventId);
      const isMMO = gId ? mmoGameIds.has(gId) : false;
      const maxPlayers = eventMaxAttendees.get(eventId) ?? null;
      this.appendRosterForEvent(
        signups,
        eventId,
        isMMO,
        maxPlayers,
        charById,
        slotCounter,
        values,
      );
    }
    return values;
  }

  /** Append roster values for a single event's signups. */
  private appendRosterForEvent(
    signups: (typeof schema.eventSignups.$inferSelect)[],
    eventId: number,
    isMMO: boolean,
    maxPlayers: number | null,
    charById: Map<string, typeof schema.characters.$inferSelect>,
    slotCounter: Map<string, number>,
    values: Record<string, unknown>[],
  ): void {
    let playerCount = 0;
    for (const signup of signups) {
      const role = this.determineRole(
        isMMO,
        maxPlayers,
        playerCount,
        signup,
        charById,
      );
      if (role === 'player') playerCount++;
      const slotKey = `${eventId}:${role}`;
      const position = (slotCounter.get(slotKey) ?? 0) + 1;
      slotCounter.set(slotKey, position);
      values.push({
        eventId: signup.eventId,
        signupId: signup.id,
        role,
        position,
      });
    }
  }

  /** Determine roster role for a signup. */
  private determineRole(
    isMMO: boolean,
    maxPlayers: number | null,
    playerCount: number,
    signup: typeof schema.eventSignups.$inferSelect,
    charById: Map<string, typeof schema.characters.$inferSelect>,
  ): string {
    if (isMMO) {
      const char = signup.characterId ? charById.get(signup.characterId) : null;
      return char?.role ?? 'dps';
    }
    if (maxPlayers && playerCount >= maxPlayers) return 'bench';
    return 'player';
  }

  /** Phase 13: Insert availability data. */
  private async installAvailability(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    generatedAvail: ReturnType<typeof generateAvailability>,
  ) {
    const mapAvail = (a: {
      username: string;
      start: Date;
      end: Date;
      status: string;
    }) => {
      const user = userByName.get(a.username);
      if (!user) return null;
      return {
        userId: user.id,
        timeRange: [a.start, a.end] as [Date, Date],
        status: a.status,
      };
    };
    const origAvailValues = getAvailabilityDefinitions()
      .map(mapAvail)
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const genAvailValues = generatedAvail
      .map(mapAvail)
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const allAvailValues = [...origAvailValues, ...genAvailValues];
    if (allAvailValues.length > 0)
      await this.batchInsert(schema.availability, allAvailValues);
    return allAvailValues;
  }

  /** Phase 14: Insert game time templates. */
  private async installGameTime(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    generatedGameTime: ReturnType<typeof generateGameTime>,
  ) {
    const mapSlot = mapGameTimeSlot(userByName);
    const origValues = getGameTimeDefinitions().map(mapSlot).filter(nonNull);
    const genValues = generatedGameTime.map(mapSlot).filter(nonNull);
    const uniqueGameTime = dedupeByKey(
      [...origValues, ...genValues],
      (gt) => `${gt.userId}:${gt.dayOfWeek}:${gt.startHour}`,
    );
    if (uniqueGameTime.length > 0)
      await this.batchInsert(
        schema.gameTimeTemplates,
        uniqueGameTime,
        'doNothing',
      );
    return uniqueGameTime;
  }

  /** Phase 15: Insert notifications. */
  private async installNotifications(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allUsers: (typeof schema.users.$inferSelect)[],
    origEvents: (typeof schema.events.$inferSelect)[],
    generatedNotifs: ReturnType<typeof generateNotifications>,
  ): Promise<number> {
    let count = 0;
    count += await this.insertAdminNotifications(origEvents, allUsers);
    count += await this.insertGeneratedNotifications(
      userByName,
      generatedNotifs,
    );
    return count;
  }

  /** Insert admin-targeted notification templates. */
  private async insertAdminNotifications(
    origEvents: (typeof schema.events.$inferSelect)[],
    allUsers: (typeof schema.users.$inferSelect)[],
  ): Promise<number> {
    const [adminUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, 'roknua'))
      .limit(1);
    if (!adminUser) return 0;
    const templates = getNotificationTemplates(
      adminUser.id,
      origEvents,
      allUsers.slice(1),
    );
    if (templates.length > 0)
      await this.batchInsert(schema.notifications, templates);
    return templates.length;
  }

  /** Insert generated notification values. */
  private async insertGeneratedNotifications(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    generatedNotifs: ReturnType<typeof generateNotifications>,
  ): Promise<number> {
    const genValues = generatedNotifs
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
      .filter(nonNull);
    if (genValues.length > 0)
      await this.batchInsert(schema.notifications, genValues);
    return genValues.length;
  }

  /** Phase 16-17: Insert notification + theme preferences. */
  private async installPreferences(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allUsers: (typeof schema.users.$inferSelect)[],
    generatedNotifPrefs: ReturnType<typeof generateNotifPreferences>,
  ): Promise<void> {
    await this.installNotifPreferences(allUsers, generatedNotifPrefs);
    await this.installThemePreferences(userByName);
  }

  /** Insert notification channel preferences for all users. */
  private async installNotifPreferences(
    allUsers: (typeof schema.users.$inferSelect)[],
    generatedNotifPrefs: ReturnType<typeof generateNotifPreferences>,
  ): Promise<void> {
    const prefsByUsername = new Map(
      generatedNotifPrefs.map((p) => [p.username, p.channelPrefs]),
    );
    const values = allUsers.map((u) => {
      const customPrefs = prefsByUsername.get(u.username);
      return customPrefs
        ? {
            userId: u.id,
            channelPrefs: customPrefs as unknown as schema.ChannelPrefs,
          }
        : { userId: u.id };
    });
    await this.batchInsert(
      schema.userNotificationPreferences,
      values,
      'doNothing',
    );
  }

  /** Insert theme preferences for hand-crafted + generated users. */
  private async installThemePreferences(
    userByName: Map<string, typeof schema.users.$inferSelect>,
  ): Promise<void> {
    const values: Record<string, unknown>[] = [];
    for (const [username, theme] of Object.entries(THEME_ASSIGNMENTS)) {
      const user = userByName.get(username);
      if (user) values.push({ userId: user.id, key: 'theme', value: theme });
    }
    const themes = ['default-dark', 'default-light', 'auto'];
    const themeRng = createRng(0xc0101);
    for (const gamer of FAKE_GAMERS.slice(ORIGINAL_GAMER_COUNT)) {
      const user = userByName.get(gamer.username);
      if (user)
        values.push({
          userId: user.id,
          key: 'theme',
          value: themes[Math.floor(themeRng() * themes.length)],
        });
    }
    if (values.length > 0)
      await this.batchInsert(schema.userPreferences, values, 'doNothing');
  }

  /** Phase 18: Insert game interests. */
  private async installGameInterests(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    igdbIdsByDbId: Map<number | null, number>,
    generatedInterests: ReturnType<typeof generateGameInterests>,
  ): Promise<void> {
    const values = generatedInterests
      .map((gi) => {
        const user = userByName.get(gi.username);
        const gameDbId = igdbIdsByDbId.get(gi.igdbId);
        if (!user || !gameDbId) return null;
        return { userId: user.id, gameId: gameDbId };
      })
      .filter((v): v is NonNullable<typeof v> => v !== null);
    const deduped = new Map<string, (typeof values)[0]>();
    for (const gi of values) deduped.set(`${gi.userId}:${gi.gameId}`, gi);
    const unique = [...deduped.values()];
    if (unique.length > 0)
      await this.batchInsert(schema.gameInterests, unique, 'doNothing');
  }

  /** Phase 19: Reassign some events to non-admin creators. */
  private async reassignEventCreators(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    allUsers: (typeof schema.users.$inferSelect)[],
    origEvents: (typeof schema.events.$inferSelect)[],
    genEvents: (typeof schema.events.$inferSelect)[],
  ): Promise<void> {
    await this.reassignOrigEventsToRaidLeader(userByName, origEvents);
    await this.reassignGenEventsRandomly(allUsers, genEvents);
  }

  /** Reassign first 2 original events to the raid leader. */
  private async reassignOrigEventsToRaidLeader(
    userByName: Map<string, typeof schema.users.$inferSelect>,
    origEvents: (typeof schema.events.$inferSelect)[],
  ): Promise<void> {
    const raidLeader = userByName.get(ROLE_ACCOUNTS[0].username);
    if (!raidLeader || origEvents.length < 2) return;
    for (const event of origEvents.slice(0, 2)) {
      await this.db
        .update(schema.events)
        .set({ creatorId: raidLeader.id })
        .where(eq(schema.events.id, event.id));
    }
  }

  /** Randomly reassign ~30% of generated events to non-admin creators. */
  private async reassignGenEventsRandomly(
    allUsers: (typeof schema.users.$inferSelect)[],
    genEvents: (typeof schema.events.$inferSelect)[],
  ): Promise<void> {
    const nonAdminUsers = allUsers.filter((u) => u.role !== 'admin');
    if (nonAdminUsers.length === 0) return;
    const rng = createRng(0xeee);
    const reassignByCreator = new Map<number, number[]>();
    for (const event of genEvents) {
      if (rng() < 0.3) {
        const creator = nonAdminUsers[Math.floor(rng() * nonAdminUsers.length)];
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

  /**
   * Delete all demo data in FK-constraint-safe order.
   */
  async clearDemoData(): Promise<DemoDataResultDto> {
    this.logger.log('Clearing demo data...');
    try {
      const countsBefore = await this.getCounts();
      await this.performClear();
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
        counts: emptyCounts(),
      };
    }
  }

  /** Execute the actual clear operations in FK-safe order. */
  private async performClear(): Promise<void> {
    const demoUsers = await this.db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.username, [...DEMO_USERNAMES] as string[]));
    const demoUserIds = demoUsers.map((u) => u.id);
    if (demoUserIds.length > 0) {
      await this.deleteDemoUserData(demoUserIds);
    }
    await this.db
      .delete(schema.notifications)
      .where(
        inArray(schema.notifications.title, [
          ...DEMO_NOTIFICATION_TITLES,
        ] as string[]),
      );
    await this.settingsService.setDemoMode(false);
  }

  /** Delete all data associated with demo user IDs in FK-safe order. */
  private async deleteDemoUserData(demoUserIds: number[]): Promise<void> {
    const demoEvents = await this.db
      .select({ id: schema.events.id })
      .from(schema.events)
      .where(inArray(schema.events.creatorId, demoUserIds));
    const demoEventIds = demoEvents.map((e) => e.id);

    if (demoEventIds.length > 0) {
      await this.db
        .update(schema.availability)
        .set({ sourceEventId: null })
        .where(inArray(schema.availability.sourceEventId, demoEventIds));
    }
    await this.db
      .delete(schema.availability)
      .where(inArray(schema.availability.userId, demoUserIds));
    await this.db
      .delete(schema.sessions)
      .where(inArray(schema.sessions.userId, demoUserIds));
    await this.db
      .delete(schema.localCredentials)
      .where(inArray(schema.localCredentials.userId, demoUserIds));
    if (demoEventIds.length > 0) {
      await this.db
        .delete(schema.events)
        .where(inArray(schema.events.id, demoEventIds));
    }
    await this.db
      .delete(schema.users)
      .where(inArray(schema.users.id, demoUserIds));
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
    if (demoUserIds.length === 0) return emptyCounts();
    return this.countDemoEntities(demoUserIds);
  }

  /** Build the parallel count queries for demo entities. */
  private buildDemoCountQueries(ids: number[]) {
    return [
      this.countRows(schema.events, inArray(schema.events.creatorId, ids)),
      this.countRows(schema.characters, inArray(schema.characters.userId, ids)),
      this.countRows(
        schema.eventSignups,
        inArray(schema.eventSignups.userId, ids),
      ),
      this.countRows(
        schema.availability,
        inArray(schema.availability.userId, ids),
      ),
      this.countRows(
        schema.gameTimeTemplates,
        inArray(schema.gameTimeTemplates.userId, ids),
      ),
      this.countRows(
        schema.notifications,
        inArray(schema.notifications.userId, ids),
      ),
    ] as const;
  }

  /** Count all demo entity types in parallel. */
  private async countDemoEntities(ids: number[]): Promise<DemoDataCountsDto> {
    const [
      events,
      characters,
      signups,
      availability,
      gameTimeSlots,
      notifications,
    ] = await Promise.all(this.buildDemoCountQueries(ids));
    return {
      users: ids.length,
      events,
      characters,
      signups,
      availability,
      gameTimeSlots,
      notifications,
    };
  }

  /** Count rows matching a where condition. */
  private async countRows(
    table: Parameters<PostgresJsDatabase<typeof schema>['insert']>[0],
    condition: ReturnType<typeof inArray>,
  ): Promise<number> {
    const c = sql<number>`count(*)::int`;
    const rows: { count: number }[] = await this.db
      .select({ count: c })
      .from(table as never)
      .where(condition);
    return rows[0]?.count ?? 0;
  }
}
