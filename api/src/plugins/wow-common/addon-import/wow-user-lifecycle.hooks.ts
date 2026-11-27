import type { UserLifecycleHooks } from '../../../users/lifecycle/user-lifecycle.types';
import {
  auditGuidRelease,
  auditGuidReleases,
  heldGuidsOf,
  releasedGuidOf,
} from './external-id.guid-release';
import {
  auditOwnerDeactivated,
  auditOwnerReactivated,
} from './external-id.owner-status';

/**
 * ROK-2364 — wow-common's USER_LIFECYCLE hooks: the ROK-2115 / ROK-2160 GUID
 * release and owner-status audits, so no member grant changes hands when a
 * GUID holder is wiped, deactivated, reactivated or loses a character.
 * Registered unconditionally (`WowCommonModule.onModuleInit`): it must run
 * even while `blizzard` is inactive.
 */
export const wowUserLifecycleHooks: UserLifecycleHooks = {
  async prepareWipe(tx, userId) {
    // Read BEFORE the wipe; audit the rows' new winners AFTER it.
    const held = await heldGuidsOf(tx, userId);
    return (finishTx) => auditGuidReleases(finishTx, held, null);
  },
  async onCharacterDeleted(tx, row, actorUserId) {
    await auditGuidRelease(tx, releasedGuidOf(row), actorUserId);
  },
  onUserDeactivated: auditOwnerDeactivated,
  onUserReactivated: auditOwnerReactivated,
};
