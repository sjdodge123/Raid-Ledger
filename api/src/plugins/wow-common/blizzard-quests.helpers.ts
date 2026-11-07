/**
 * Completed-quest fetching helpers for BlizzardService (ROK-2109).
 * Mirrors blizzard-professions.helpers.ts.
 *
 * Only WoW: Forever is asked (D2): every quest consumer gates on the Forever
 * game slug, so retail/classic syncs make no extra call. Any outcome without
 * a usable list — skip, 404, non-OK, network throw, unparseable body —
 * returns `null`, which the sync treats as "leave `armory_quests` alone".
 *
 * Only `quests[].id` is read; `name`/`key` are dropped (D3). The list is
 * deduped, sorted ascending and capped at the addon limit keeping the LOWEST
 * ids — the same truncation semantics as the LedgerLink snapshot.
 */
import { z } from 'zod';
import { ADDON_QUESTS_COMPLETED_MAX } from '@raid-ledger/contract';
import type { ExternalCharacterQuests } from '../plugin-host/extension-types';
import { buildCharacterParams } from './blizzard-character.helpers';
import { FOREVER_NAMESPACE_ALIAS } from './forever-namespace.resolver';

type Logger = {
  warn: (msg: string) => void;
  log: (msg: string) => void;
  debug?: (msg: string) => void;
};

/** Stored shape of `characters.armory_quests` (D1). */
export const ArmoryQuestsSchema = z.object({
  fetchedAt: z.string().datetime(),
  completed: z
    .array(z.number().int().positive())
    .max(ADDON_QUESTS_COMPLETED_MAX),
  completedTruncated: z.literal(true).optional(),
});

export type ArmoryQuests = z.infer<typeof ArmoryQuestsSchema>;

const RawCompletedSchema = z.object({
  quests: z.array(z.object({ id: z.unknown() }).passthrough()),
});

/** Integer ids > 0, deduped, ascending, capped (lowest kept). */
function normaliseIds(raw: unknown[]): {
  completed: number[];
  truncated: boolean;
} {
  const ids = new Set<number>();
  for (const id of raw) {
    if (typeof id === 'number' && Number.isInteger(id) && id > 0) ids.add(id);
  }
  const sorted = [...ids].sort((a, b) => a - b);
  const truncated = sorted.length > ADDON_QUESTS_COMPLETED_MAX;
  return {
    completed: truncated ? sorted.slice(0, ADDON_QUESTS_COMPLETED_MAX) : sorted,
    truncated,
  };
}

/** Parse a `quests/completed` body; `null` when it has no `quests` array. */
export function parseCompletedQuests(
  body: unknown,
  fetchedAt: string = new Date().toISOString(),
): ExternalCharacterQuests | null {
  const parsed = RawCompletedSchema.safeParse(body);
  if (!parsed.success) return null;
  const { completed, truncated } = normaliseIds(
    parsed.data.quests.map((q) => q.id),
  );
  return {
    fetchedAt,
    completed,
    ...(truncated ? { completedTruncated: true as const } : {}),
  };
}

async function requestCompleted(
  url: string,
  token: string,
  characterPath: string,
  logger: Logger,
): Promise<ExternalCharacterQuests | null> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) {
    logger.debug?.(`Quests 404 for ${characterPath} — leaving prior value`);
    return null;
  }
  if (!res.ok) {
    logger.warn(`Quests fetch failed for ${characterPath}: ${res.status}`);
    return null;
  }
  const parsed = parseCompletedQuests(await res.json());
  if (parsed === null) {
    logger.warn(`Quests body for ${characterPath} had no quests array`);
  }
  return parsed;
}

/** Fetch a Forever character's completed quest ids from the Blizzard API. */
export async function fetchCharacterQuests(
  name: string,
  realm: string | null,
  region: string,
  apiNamespacePrefix: string | null,
  token: string,
  logger: Logger,
): Promise<ExternalCharacterQuests | null> {
  if (apiNamespacePrefix !== FOREVER_NAMESPACE_ALIAS) return null;
  const { characterPath, namespace, baseUrl } = buildCharacterParams(
    name,
    realm,
    region,
    apiNamespacePrefix,
  );
  const url = `${baseUrl}/profile/wow/character/${characterPath}/quests/completed?namespace=${namespace}&locale=en_US`;
  try {
    return await requestCompleted(url, token, characterPath, logger);
  } catch (err) {
    logger.warn(`Failed to fetch character quests: ${err}`);
    return null;
  }
}
