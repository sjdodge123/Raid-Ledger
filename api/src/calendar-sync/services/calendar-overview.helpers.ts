/**
 * ROK-1591: builds `GET /users/me/calendars` (CalendarsOverview).
 *
 * Contract objects are `.strict()`, so every response object is built field
 * by field — never spread a DB row. The row select names its columns and
 * never includes `credentials_encrypted`.
 */
import { asc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  CALENDAR_LOOK_AHEAD_WEEKS,
  type CalendarConnection,
  type CalendarConnectionStatus,
  type CalendarProvider,
  type CalendarReadSettings,
  type CalendarWriteTarget,
  type CalendarsOverview,
} from '@raid-ledger/contract';
import * as schema from '../../drizzle/schema';
import { calendarConnections } from '../../drizzle/schema';
import type { SettingsCore } from '../../settings/settings-bot.helpers';
import {
  getCalendarProviderConfig,
  getCalendarSyncEnabled,
  type CalendarOAuthProvider,
} from '../../settings/settings-calendar-sync.helpers';

type Db = PostgresJsDatabase<typeof schema>;
type ProviderAvailability = CalendarsOverview['providers'];

/** Columns the overview may read. `credentialsEncrypted` is deliberately absent. */
const CONNECTION_COLUMNS = {
  id: calendarConnections.id,
  provider: calendarConnections.provider,
  accountLabel: calendarConnections.accountLabel,
  status: calendarConnections.status,
  lastSyncedAt: calendarConnections.lastSyncedAt,
  lastErrorCode: calendarConnections.lastErrorCode,
  readEnabled: calendarConnections.readEnabled,
  readCalendarIds: calendarConnections.readCalendarIds,
  writeEnabled: calendarConnections.writeEnabled,
  writeTarget: calendarConnections.writeTarget,
};

export interface CalendarConnectionRow {
  id: number;
  provider: string;
  accountLabel: string | null;
  status: string;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  readEnabled: boolean;
  readCalendarIds: string[];
  writeEnabled: boolean;
  writeTarget: string;
}

/** Read settings are fixed until ROK-1593 makes the mode a user choice. */
function defaultReadSettings(): CalendarReadSettings {
  return { mode: 'both', lookAheadWeeks: CALENDAR_LOOK_AHEAD_WEEKS };
}

/** The switch-off overview: nothing available, nothing listed. */
export function buildDisabledOverview(): CalendarsOverview {
  return {
    enabled: false,
    providers: {
      google: { available: false },
      microsoft: { available: false },
      apple: { available: false },
    },
    connections: [],
    readSettings: defaultReadSettings(),
    feed: null,
  };
}

/** An OAuth provider is available once its client id AND secret are set. */
async function isOAuthProviderConfigured(
  svc: SettingsCore,
  provider: CalendarOAuthProvider,
): Promise<boolean> {
  const config = await getCalendarProviderConfig(svc, provider);
  return Boolean(config.clientId) && config.hasSecret;
}

/**
 * Provider availability: OAuth providers need the switch on plus a client id
 * and secret; Apple (app-specific password, no OAuth client) needs the switch.
 */
export async function getProviderAvailability(
  svc: SettingsCore,
  enabled: boolean,
): Promise<ProviderAvailability> {
  if (!enabled) return buildDisabledOverview().providers;
  const [google, microsoft] = await Promise.all([
    isOAuthProviderConfigured(svc, 'google'),
    isOAuthProviderConfigured(svc, 'microsoft'),
  ]);
  return {
    google: { available: google },
    microsoft: { available: microsoft },
    apple: { available: true },
  };
}

/**
 * Map a row to the wire shape. The enum casts are safe: the table's CHECK
 * constraints pin provider, status and write_target to the contract enums.
 */
export function toCalendarConnection(
  row: CalendarConnectionRow,
): CalendarConnection {
  return {
    id: row.id,
    provider: row.provider as CalendarProvider,
    accountLabel: row.accountLabel,
    status: row.status as CalendarConnectionStatus,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    errorCode: row.lastErrorCode,
    read: { enabled: row.readEnabled, calendarIds: [...row.readCalendarIds] },
    write: {
      enabled: row.writeEnabled,
      target: row.writeTarget as CalendarWriteTarget,
    },
  };
}

/** The user's connections, oldest first, credentials never selected. */
export async function listUserConnections(
  db: Db,
  userId: number,
): Promise<CalendarConnection[]> {
  const rows = await db
    .select(CONNECTION_COLUMNS)
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, userId))
    .orderBy(asc(calendarConnections.id));
  return rows.map(toCalendarConnection);
}

/** `GET /users/me/calendars`. With the kill switch off, the fixed off shape. */
export async function buildCalendarsOverview(
  db: Db,
  svc: SettingsCore,
  userId: number,
): Promise<CalendarsOverview> {
  if (!(await getCalendarSyncEnabled(svc))) return buildDisabledOverview();
  const [providers, connections] = await Promise.all([
    getProviderAvailability(svc, true),
    listUserConnections(db, userId),
  ]);
  return {
    enabled: true,
    providers,
    connections,
    readSettings: defaultReadSettings(),
    feed: null,
  };
}
