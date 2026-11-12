/**
 * ROK-2187 — read/write the GG <year> delivery settings (app_settings keys
 * GG_ENABLED … GG_CHANNEL_ID). Unset/malformed values fall back to the
 * ruled defaults (Q1, R7); GG_ENABLED unset ⇒ off (kill switch).
 */
import type {
  GgAdminSettingsDto,
  GgAdminSettingsUpdateDto,
} from '@raid-ledger/contract';
import { SETTING_KEYS, type SettingKey } from '../../../drizzle/schema';
import {
  GG_DEFAULT_DELIVERY_HOUR,
  GG_DEFAULT_DM_OFFSET_MINUTES,
  effectiveGgDeliveryDate,
} from './gg-delivery.schedule';

/** The slice of `SettingsService` these helpers use. */
export interface GgSettingsStore {
  get(key: SettingKey): Promise<string | null>;
  set(key: SettingKey, value: string): Promise<void>;
  delete(key: SettingKey): Promise<void>;
}

/** Delivery settings without the mascot (owned by the mascot module). */
export type GgDeliverySettings = Omit<GgAdminSettingsDto, 'mascot'>;

function intIn(
  raw: string | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (raw === null || !/^\d+$/.test(raw.trim())) return fallback;
  const n = Number(raw);
  return n >= min && n <= max ? n : fallback;
}

/**
 * Current settings; `defaultYear` is the current community-tz year — the
 * default date's year, and the floor below which a stored date is stale.
 */
export async function readGgDeliverySettings(
  store: Pick<GgSettingsStore, 'get'>,
  defaultYear: number,
): Promise<GgDeliverySettings> {
  const k = SETTING_KEYS;
  const [enabled, date, hour, offset, channel] = await Promise.all([
    store.get(k.GG_ENABLED),
    store.get(k.GG_DELIVERY_DATE),
    store.get(k.GG_DELIVERY_HOUR),
    store.get(k.GG_DM_OFFSET_MINUTES),
    store.get(k.GG_CHANNEL_ID),
  ]);
  const trimmedChannel = channel?.trim() ?? '';
  return {
    enabled: enabled === 'true',
    deliveryDate: effectiveGgDeliveryDate(date, defaultYear),
    deliveryHour: intIn(hour, 0, 23, GG_DEFAULT_DELIVERY_HOUR),
    dmOffsetMinutes: intIn(offset, 0, 1440, GG_DEFAULT_DM_OFFSET_MINUTES),
    channelId: trimmedChannel === '' ? null : trimmedChannel,
  };
}

/** Persist every key present in `patch`; `channelId: null` clears it. */
export async function writeGgDeliverySettings(
  store: GgSettingsStore,
  patch: GgAdminSettingsUpdateDto,
): Promise<void> {
  const k = SETTING_KEYS;
  if (patch.enabled !== undefined) {
    await store.set(k.GG_ENABLED, String(patch.enabled));
  }
  if (patch.deliveryDate !== undefined) {
    await store.set(k.GG_DELIVERY_DATE, patch.deliveryDate);
  }
  if (patch.deliveryHour !== undefined) {
    await store.set(k.GG_DELIVERY_HOUR, String(patch.deliveryHour));
  }
  if (patch.dmOffsetMinutes !== undefined) {
    await store.set(k.GG_DM_OFFSET_MINUTES, String(patch.dmOffsetMinutes));
  }
  if (patch.channelId === null) await store.delete(k.GG_CHANNEL_ID);
  else if (patch.channelId !== undefined) {
    await store.set(k.GG_CHANNEL_ID, patch.channelId);
  }
}
