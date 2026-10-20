import { BadRequestException } from '@nestjs/common';
import {
  ChannelLifecycleSettingsSchema,
  LIFECYCLE_DEFAULTS,
  UpdateChannelLifecycleSettingsSchema,
  type ChannelLifecycleSettingsDto,
  type UpdateChannelLifecycleSettingsDto,
} from '@raid-ledger/contract';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';
import type { SettingsCore } from './settings-bot.helpers';

/**
 * ROK-1429 (ROK-1428 L2): the Discord channel lifecycle settings group. Every
 * value is stored as a string in app_settings; unset or invalid values read
 * back as the contract defaults, so the automation is OFF until an admin
 * turns it on.
 */

const K = {
  enabled: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_ENABLED,
  recentActivityDays: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_RECENT_DAYS,
  createThreshold: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_CREATE_THRESHOLD,
  gamesCategoryId: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_GAMES_CATEGORY_ID,
  archiveCategoryId: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_ARCHIVE_CATEGORY_ID,
  hideOnArchive: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_HIDE_ON_ARCHIVE,
  maxChangesPerTick:
    SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_MAX_CHANGES_PER_TICK,
  lastRunAt: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_LAST_RUN_AT,
  lastRunError: SETTING_KEYS.DISCORD_CHANNEL_LIFECYCLE_LAST_RUN_ERROR,
} as const satisfies Record<keyof ChannelLifecycleSettingsDto, SettingKey>;

type IntKey = 'recentActivityDays' | 'createThreshold' | 'maxChangesPerTick';

/** The outcome of one reconcile run, recorded for the admin health line. */
export interface ChannelLifecycleRunRecord {
  at: Date;
  /** null = the run was clean (clears any previous error). */
  error: string | null;
}

/** Parse a stored integer, falling back to the default when invalid or out of range. */
function readInt(raw: string | null, key: IntKey): number {
  const parsed = ChannelLifecycleSettingsSchema.shape[key].safeParse(
    raw === null ? NaN : Number(raw),
  );
  return parsed.success ? parsed.data : LIFECYCLE_DEFAULTS[key];
}

/** Empty or unset ⇒ null. */
function readNullable(raw: string | null): string | null {
  return raw === null || raw === '' ? null : raw;
}

/** A stored ISO timestamp, or null when unset or malformed. */
function readIsoDate(raw: string | null): string | null {
  const parsed = ChannelLifecycleSettingsSchema.shape.lastRunAt.safeParse(
    readNullable(raw),
  );
  return parsed.success ? parsed.data : null;
}

/** Read the whole lifecycle settings group (defaults fill every gap). */
export async function getChannelLifecycleSettings(
  svc: SettingsCore,
): Promise<ChannelLifecycleSettingsDto> {
  const keys = Object.keys(K) as (keyof typeof K)[];
  const values = await Promise.all(keys.map((k) => svc.get(K[k])));
  const raw = new Map(keys.map((k, i) => [k, values[i] ?? null]));
  const get = (k: keyof typeof K): string | null => raw.get(k) ?? null;
  return {
    enabled: get('enabled') === 'true',
    recentActivityDays: readInt(
      get('recentActivityDays'),
      'recentActivityDays',
    ),
    createThreshold: readInt(get('createThreshold'), 'createThreshold'),
    gamesCategoryId: readNullable(get('gamesCategoryId')),
    archiveCategoryId: readNullable(get('archiveCategoryId')),
    hideOnArchive: get('hideOnArchive') === 'true',
    maxChangesPerTick: readInt(get('maxChangesPerTick'), 'maxChangesPerTick'),
    lastRunAt: readIsoDate(get('lastRunAt')),
    lastRunError: readNullable(get('lastRunError')),
  };
}

/** Write one optional value: undefined = untouched, null = cleared. */
async function writeValue(
  svc: SettingsCore,
  key: SettingKey,
  value: string | number | boolean | null | undefined,
): Promise<void> {
  if (value === undefined) return;
  if (value === null) return svc.delete(key);
  await svc.set(key, String(value));
}

/**
 * Validate and apply a partial update (UpdateChannelLifecycleSettingsSchema —
 * strict, so the run-status keys are rejected). Nothing is written when the
 * patch is invalid. Returns the merged settings.
 */
export async function setChannelLifecycleSettings(
  svc: SettingsCore,
  patch: UpdateChannelLifecycleSettingsDto | Record<string, unknown>,
): Promise<ChannelLifecycleSettingsDto> {
  const parsed = UpdateChannelLifecycleSettingsSchema.safeParse(patch);
  if (!parsed.success) {
    throw new BadRequestException({
      message: 'Invalid channel lifecycle settings',
      errors: parsed.error.issues,
    });
  }
  const p = parsed.data;
  await writeValue(svc, K.enabled, p.enabled);
  await writeValue(svc, K.recentActivityDays, p.recentActivityDays);
  await writeValue(svc, K.createThreshold, p.createThreshold);
  await writeValue(svc, K.gamesCategoryId, p.gamesCategoryId);
  await writeValue(svc, K.archiveCategoryId, p.archiveCategoryId);
  await writeValue(svc, K.hideOnArchive, p.hideOnArchive);
  await writeValue(svc, K.maxChangesPerTick, p.maxChangesPerTick);
  return getChannelLifecycleSettings(svc);
}

/** Record a reconcile run's time and error (null error clears the last one). */
export async function recordChannelLifecycleRun(
  svc: SettingsCore,
  run: ChannelLifecycleRunRecord,
): Promise<void> {
  await svc.set(K.lastRunAt, run.at.toISOString());
  await writeValue(svc, K.lastRunError, run.error);
}
