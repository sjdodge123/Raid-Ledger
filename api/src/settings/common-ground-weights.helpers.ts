import {
  FULL_PRICE_PENALTY,
  INTENSITY_WEIGHT,
  OWNER_WEIGHT,
  SALE_BONUS,
  SOCIAL_WEIGHT,
  TASTE_WEIGHT,
  type CommonGroundWeights,
} from '../lineups/common-ground-scoring.constants';
import { SETTING_KEYS } from '../drizzle/schema/app-settings';

type SettingGetter = (key: string) => Promise<string | null>;

/** Parse a DB-stored numeric weight, falling back to `fallback` if invalid. */
export function parseWeight(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Resolve Common Ground scoring weights from DB settings with defaults (ROK-950).
 * Each weight falls back to its constant default if unset or non-numeric.
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
