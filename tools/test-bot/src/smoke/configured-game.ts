/**
 * Configured-game + throwaway-character fixtures (TDB:764/808, B58).
 *
 * Three companion smokes used to log SKIP and PASS in 0.0s whenever the
 * smoke admin had no characters (`ctx.games` / `ctx.mmoGameId` come only
 * from that admin). These helpers give them a real game and, for ROK-868, a
 * character that lives only for the duration of the test — so a missing
 * precondition now FAILS with a named reason instead of passing hollow.
 *
 * Reads registry rows (`GET /games/configured`) rather than `ctx.games`,
 * because `ctx.games` can carry synthetic/placeholder names and the digest
 * test matches the real name in a posted embed.
 *
 * Pure apart from the API client it is handed — `configured-game.spec.ts`
 * drives it with a stub. Never assigns anything to the shared TestContext:
 * flipping `ctx.mmoGameId` would re-route every MMO path in the suite.
 */
import type { ApiClient } from './api.js';

export const NO_CONFIGURED_GAME =
  'fixture precondition: GET /games/configured returned no enabled game';
export const NO_CONFIGURED_ROLE_GAME =
  'fixture precondition: GET /games/configured returned no game with hasRoles=true';

export interface ConfiguredGame {
  id: number;
  name: string;
  hasRoles: boolean;
}

/** The slice of TestContext the lookup needs. */
export interface ConfiguredGameSource {
  api: Pick<ApiClient, 'get'>;
}

/** Accept both the `{ data: [] }` envelope and a bare array. */
function rowsOf(res: unknown): ConfiguredGame[] {
  if (Array.isArray(res)) return res as ConfiguredGame[];
  const data = (res as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as ConfiguredGame[]) : [];
}

/**
 * The first enabled, non-banned game in the registry (name-ordered by the
 * API), optionally restricted to games with roles. Throws a named
 * precondition when nothing matches — never returns undefined.
 */
export async function resolveConfiguredGame(
  ctx: ConfiguredGameSource,
  opts: { hasRoles?: boolean } = {},
): Promise<ConfiguredGame> {
  const rows = rowsOf(await ctx.api.get<unknown>('/games/configured'));
  const match = rows.find(
    (g) => opts.hasRoles === undefined || g.hasRoles === opts.hasRoles,
  );
  if (match) return { id: match.id, name: match.name, hasRoles: match.hasRoles };
  throw new Error(opts.hasRoles ? NO_CONFIGURED_ROLE_GAME : NO_CONFIGURED_GAME);
}

export interface ThrowawayCharacter {
  id: string;
  name: string;
  gameId: number;
  role?: string | null;
}

type CharacterApi = Pick<ApiClient, 'get' | 'post' | 'delete'>;

/** Delete leftovers from an earlier run that died before its finally. */
async function sweepLeftovers(api: CharacterApi, prefix: string): Promise<void> {
  const res = await api.get<unknown>('/users/me/characters');
  const rows = (Array.isArray(res) ? res : rowsOf(res)) as unknown as ThrowawayCharacter[];
  for (const c of rows.filter((r) => r.name?.startsWith(prefix))) {
    console.log(`    Sweeping leftover throwaway character ${c.name} (${c.id})`);
    await api.delete(`/users/me/characters/${c.id}`);
  }
}

/**
 * Create a character for `gameId` on the smoke admin, hand it to `fn`, and
 * DELETE it in a finally — even when `fn` throws. `prefix` must be specific
 * to the calling test: leftovers carrying it are swept before the create,
 * and `setup.ts::setupCharacters` would otherwise pick a leaked one up as
 * the suite-wide ctx.mmoGameId on the next run.
 */
export async function withThrowawayCharacter<T>(
  api: CharacterApi,
  gameId: number,
  prefix: string,
  fn: (char: ThrowawayCharacter) => Promise<T>,
): Promise<T> {
  await sweepLeftovers(api, prefix);
  const char = await api.post<ThrowawayCharacter>('/users/me/characters', {
    gameId,
    name: `${prefix}${Date.now()}`,
    role: 'dps',
  });
  if (!char?.id) {
    throw new Error(`Character create returned no id: ${JSON.stringify(char)}`);
  }
  try {
    return await fn(char);
  } finally {
    await api.delete(`/users/me/characters/${char.id}`);
  }
}
