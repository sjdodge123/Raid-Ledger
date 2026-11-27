import type {
  DeletedCharacterRow,
  UserLifecycleHooks,
  UserLifecycleTx,
  UserWipeFinisher,
} from './user-lifecycle.types';

/**
 * ROK-2364 — the USER_LIFECYCLE extension point. Core owns this registry and
 * calls the runners below; a plugin registers ONE hooks object into it, so
 * core user delete / deactivate / reactivate never imports plugin internals.
 *
 * It deliberately never asks whether the owning plugin is active, and it is
 * NOT the adapter registry (which suspends an owner's adapters on deactivate):
 * cleanup of data a user withdrew runs regardless of plugin state (CLAUDE.md,
 * "Hub widgets and behaviours belong to a plugin"). Plugins register at module
 * init, unconditionally. Keyed by owner, so a re-init replaces, never doubles.
 */
const hooksByOwner = new Map<string, UserLifecycleHooks>();

export function registerUserLifecycleHooks(
  ownerPluginId: string,
  hooks: UserLifecycleHooks,
): void {
  hooksByOwner.set(ownerPluginId, hooks);
}

/** The registered hooks, ordered by owner id (deterministic run order). */
export function userLifecycleHooks(): UserLifecycleHooks[] {
  return [...hooksByOwner.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, hooks]) => hooks);
}

/** Phase one of a wipe (before the delete); call the result after it. */
export async function runPrepareWipe(
  tx: UserLifecycleTx,
  userId: number,
): Promise<UserWipeFinisher> {
  const finishers: UserWipeFinisher[] = [];
  for (const hooks of userLifecycleHooks()) {
    if (hooks.prepareWipe) finishers.push(await hooks.prepareWipe(tx, userId));
  }
  return async (finishTx) => {
    for (const finish of finishers) await finish(finishTx);
  };
}

export async function runCharacterDeleted(
  tx: UserLifecycleTx,
  row: DeletedCharacterRow,
  actorUserId: number,
): Promise<void> {
  for (const hooks of userLifecycleHooks()) {
    await hooks.onCharacterDeleted?.(tx, row, actorUserId);
  }
}

export async function runUserDeactivated(
  tx: UserLifecycleTx,
  userId: number,
  actorId: number | null,
): Promise<void> {
  for (const hooks of userLifecycleHooks()) {
    await hooks.onUserDeactivated?.(tx, userId, actorId);
  }
}

/** @returns the audits all hooks wrote. */
export async function runUserReactivated(
  tx: UserLifecycleTx,
  userId: number,
  deactivatedAt: string,
  actorId: number | null,
): Promise<number> {
  let written = 0;
  for (const hooks of userLifecycleHooks()) {
    if (!hooks.onUserReactivated) continue;
    written += await hooks.onUserReactivated(tx, userId, deactivatedAt, actorId);
  }
  return written;
}
