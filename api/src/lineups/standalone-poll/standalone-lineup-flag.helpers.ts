/**
 * The one SQL definition of "this lineup row is a standalone scheduling
 * poll's storage row" (`phase_duration_override.standalone`, ROK-1067), as a
 * select field. Shared by poll completion (ROK-2024: only a standalone poll
 * archives its lineup) and the lineup notification targets (ROK-2054: a
 * standalone lock-in posts no lineup-family channel card).
 *
 * A function, not a constant: each query gets its own fragment.
 */
import { sql, type SQL } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';

export function standaloneLineupFlag(): SQL<boolean> {
  return sql<boolean>`coalesce(${schema.communityLineups.phaseDurationOverride}->>'standalone' = 'true', false)`;
}
