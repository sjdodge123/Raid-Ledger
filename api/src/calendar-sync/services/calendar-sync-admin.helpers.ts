/**
 * ROK-1591: `GET/PUT /admin/settings/calendar-sync` shapes.
 *
 * The read shape carries `hasSecret`, never a secret: it is built from
 * `getCalendarProviderConfig` without `includeSecret`, field by field, so the
 * contract's `.strict()` schema matches exactly.
 */
import { Logger } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import type {
  AdminCalendarSyncSettings,
  UpdateAdminCalendarSyncSettings,
} from '@raid-ledger/contract';
import {
  getClientUrl,
  type SettingsCore,
} from '../../settings/settings-bot.helpers';
import {
  getCalendarProviderConfig,
  getCalendarSyncEnabled,
  setCalendarProviderConfig,
  setCalendarSyncEnabled,
  type CalendarOAuthProvider,
  type CalendarProviderConfigUpdate,
} from '../../settings/settings-calendar-sync.helpers';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../../drizzle/schema';
import {
  enqueueAllReadSyncs,
  type CalendarReadQueue,
} from '../read/calendar-read.enqueue.helpers';
import { purgeAllCalendarReadData } from '../read/calendar-read-purge.helpers';
import {
  CALENDAR_OAUTH_PROVIDERS,
  oauthCallbackPath,
} from '../calendar-sync.constants';

type Db = PostgresJsDatabase<typeof schema>;
type AdminProviderSettings = AdminCalendarSyncSettings['google'];

async function readProvider(
  svc: SettingsCore,
  provider: CalendarOAuthProvider,
): Promise<AdminProviderSettings> {
  const config = await getCalendarProviderConfig(svc, provider);
  return { clientId: config.clientId, hasSecret: config.hasSecret };
}

/** Exact redirect URIs for the provider consoles, from `CLIENT_URL` (D6). */
export async function buildRedirectUris(
  svc: SettingsCore,
): Promise<AdminCalendarSyncSettings['redirectUris']> {
  const base = (await getClientUrl(svc)).replace(/\/+$/, '');
  return {
    google: `${base}${oauthCallbackPath('google')}`,
    microsoft: `${base}${oauthCallbackPath('microsoft')}`,
  };
}

/** The admin read shape. */
export async function buildAdminCalendarSyncSettings(
  svc: SettingsCore,
): Promise<AdminCalendarSyncSettings> {
  const [enabled, google, microsoft, redirectUris] = await Promise.all([
    getCalendarSyncEnabled(svc),
    readProvider(svc, 'google'),
    readProvider(svc, 'microsoft'),
    buildRedirectUris(svc),
  ]);
  return { enabled, google, microsoft, redirectUris };
}

/** Drop absent keys: an omitted field leaves the stored value alone. */
function toProviderConfigUpdate(
  u: NonNullable<UpdateAdminCalendarSyncSettings[CalendarOAuthProvider]>,
): CalendarProviderConfigUpdate {
  return {
    ...(u.clientId !== undefined ? { clientId: u.clientId } : {}),
    ...(u.clientSecret !== undefined ? { clientSecret: u.clientSecret } : {}),
  };
}

/**
 * Apply a validated PUT body. Omitted fields are left alone; an empty string
 * clears a client id or secret.
 */
export async function applyAdminCalendarSyncUpdate(
  svc: SettingsCore,
  update: UpdateAdminCalendarSyncSettings,
  effects?: KillSwitchEffects,
): Promise<void> {
  for (const provider of CALENDAR_OAUTH_PROVIDERS) {
    const providerUpdate = update[provider];
    if (providerUpdate) {
      await setCalendarProviderConfig(
        svc,
        provider,
        toProviderConfigUpdate(providerUpdate),
      );
    }
  }
  if (update.enabled !== undefined) {
    await setCalendarSyncEnabled(svc, update.enabled);
    if (effects) await applyKillSwitchEffectsSafely(effects, update.enabled);
  }
}

/** ROK-1593 D10: what flipping the kill switch does to read data. */
export interface KillSwitchEffects {
  db: Db;
  readQueue: CalendarReadQueue;
  /** `GameTimeService.invalidateUserCache`. */
  invalidateUser: (userId: number) => void;
}

/**
 * Off → every busy block and every synced (`source='calendar'`) absence is
 * deleted in the request (busy hours and away days stop counting at once;
 * manual absences stay). On → a sync is queued for every read connection,
 * which rebuilds both — each sync derives in its own transaction. Runs after the setting is written, so
 * the processor's own kill-switch re-check already sees the new value.
 */
export async function applyKillSwitchEffects(
  effects: KillSwitchEffects,
  enabled: boolean,
): Promise<void> {
  if (!enabled) {
    const users = await purgeAllCalendarReadData(effects.db);
    users.forEach((u) => effects.invalidateUser(u));
    return;
  }
  await enqueueAllReadSyncs(effects.db, {
    queue: effects.readQueue,
    isSyncEnabled: () => Promise.resolve(true),
  });
}

const logger = new Logger('CalendarSyncAdmin');

/**
 * The switch is already saved when the effects run, so a purge/enqueue
 * failure (e.g. Redis down) must not turn the admin's save into a 500 for a
 * setting that DID change. Logged at error level + sent to Sentry instead.
 * Recovery: while off, the busy query ignores blocks and the read cron
 * deletes any synced absence still stored every tick;
 * the next enable (or the read cron) re-enqueues the syncs.
 */
async function applyKillSwitchEffectsSafely(
  effects: KillSwitchEffects,
  enabled: boolean,
): Promise<void> {
  try {
    await applyKillSwitchEffects(effects, enabled);
  } catch (err) {
    const code = err instanceof Error ? err.name : 'unknown';
    const step = enabled ? 'sync enqueue' : 'purge (cron self-heals)';
    logger.error(`calendar sync kill-switch ${step} failed: ${code}`);
    Sentry.captureException(err);
  }
}
