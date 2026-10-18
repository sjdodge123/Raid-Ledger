import type { ValheimProfileRow } from '../../../drizzle/schema';
import type { ValheimLinkTx } from '../link/valheim-link-token-lock';

/**
 * ROK-1835 L3 seam. The importer calls `onProfileUpserted` INSIDE the
 * snapshot's transaction, right after a profile row was inserted or replaced
 * (never for a stale snapshot). It is the ONLY place `claimed_by` may be set
 * on import — identity rule A1 (auto-attach to a Raid-Ledger-verified
 * `users.steam_id`, active users only) lives in L3's implementation. The
 * mod-asserted `profile.steamId` is never written to `users` (R5).
 *
 * Use `tx` for every statement; a throw rolls the whole snapshot back and
 * marks it `failed` (`internal:<err.name>`), so do not catch-and-retry a
 * failed statement inside it (postgres.js poisons the transaction).
 */
export interface ValheimProfileUpsertedHook {
  onProfileUpserted(
    tx: ValheimLinkTx,
    profile: ValheimProfileRow,
  ): Promise<void>;
}

/** Nest injection token for {@link ValheimProfileUpsertedHook}. */
export const VALHEIM_PROFILE_UPSERTED_HOOK = Symbol(
  'VALHEIM_PROFILE_UPSERTED_HOOK',
);

/** L2 default: no identity matching yet (L3 replaces the provider). */
export const NOOP_PROFILE_UPSERTED_HOOK: ValheimProfileUpsertedHook = {
  onProfileUpserted: () => Promise.resolve(),
};
