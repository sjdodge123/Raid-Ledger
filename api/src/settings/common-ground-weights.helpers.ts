import { Logger } from '@nestjs/common';
import {
  FULL_PRICE_PENALTY,
  INTENSITY_WEIGHT,
  OWNER_WEIGHT,
  SALE_BONUS,
  SOCIAL_WEIGHT,
  TASTE_WEIGHT,
  type CommonGroundWeights,
} from '../lineups/common-ground-scoring.constants';
import { SETTING_KEYS, type SettingKey } from '../drizzle/schema/app-settings';

type SettingGetter = (key: SettingKey) => Promise<string | null>;

const logger = new Logger('CommonGroundWeights');

export const PARSE_WEIGHT_MIN = 0;
export const PARSE_WEIGHT_MAX = 1000;

/**
 * Parse a DB-stored numeric weight, falling back to `fallback` if invalid.
 * Clamps finite values to [PARSE_WEIGHT_MIN, PARSE_WEIGHT_MAX] and logs a
 * warning when a stored value is outside the allowed range so operators can
 * spot misconfiguration (e.g. a 1e9 weight that would starve the base score).
 */
export function parseWeight(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  if (n < PARSE_WEIGHT_MIN) {
    logger.warn(
      `Weight ${n} below minimum ${PARSE_WEIGHT_MIN}, clamping to ${PARSE_WEIGHT_MIN}`,
    );
    return PARSE_WEIGHT_MIN;
  }
  if (n > PARSE_WEIGHT_MAX) {
    logger.warn(
      `Weight ${n} above maximum ${PARSE_WEIGHT_MAX}, clamping to ${PARSE_WEIGHT_MAX}`,
    );
    return PARSE_WEIGHT_MAX;
  }
  return n;
}

/**
 * Resolve Common Ground scoring weights from DB settings with defaults (ROK-950).
 * Each weight falls back to its constant default if unset or non-numeric,
 * and is clamped to [PARSE_WEIGHT_MIN, PARSE_WEIGHT_MAX] (ROK-1090).
 */
export async function resolveCommonGroundWeights(
  get: SettingGetter,
): Promise<CommonGroundWeights> {
  const [tasteRaw, socialRaw, intensityRaw] = await Promise.all([
    get(SETTING_KEYS.COMMON_GROUND_TASTE_WEIGHT),
    get(SETTING_KEYS.COMMON_GROUND_SOCIAL_WEIGHT),
    get(SETTING_KEYS.COMMON_GROUND_INTENSITY_WEIGHT),
  ]);
  return {
    ownerWeight: OWNER_WEIGHT,
    saleBonus: SALE_BONUS,
    fullPricePenalty: FULL_PRICE_PENALTY,
    tasteWeight: parseWeight(tasteRaw, TASTE_WEIGHT),
    socialWeight: parseWeight(socialRaw, SOCIAL_WEIGHT),
    intensityWeight: parseWeight(intensityRaw, INTENSITY_WEIGHT),
  };
}
