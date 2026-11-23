/**
 * ROK-1813 — the optional `withPublicCard: true` half of the DEMO_MODE
 * `POST /admin/test/wow/seed-guild` fixture: switches the guild's opt-in
 * public card on (the flag implies `withRecruitment`, so the card has rows
 * and an Apply URL) and reports the slug for `/p/guild/:slug`. Idempotent
 * and restoring: a re-call switches it back on with the SAME slug, so it is
 * the fleet test plan's reset after a toggle-off step.
 */
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type * as schema from '../drizzle/schema';
import { defined } from '../common/defined.helpers';
import { enablePublicCard } from '../plugins/wow-common/guilds/public-card/guild-public-card.queries';

type Db = PostgresJsDatabase<typeof schema>;

/** `withPublicCard`: card on, `{publicCardSlug}`; `{}` when not asked. */
export async function seedPublicCardHalf(
  db: Db,
  input: { withPublicCard: boolean },
  guildId: number,
): Promise<{ publicCardSlug?: string }> {
  if (!input.withPublicCard) return {};
  const settings = await enablePublicCard(db, guildId);
  return { publicCardSlug: defined(settings.slug ?? undefined, 'card slug') };
}
