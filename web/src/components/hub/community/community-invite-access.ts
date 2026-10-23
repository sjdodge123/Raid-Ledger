/**
 * ROK-1893 §8a(a) — who may make hub invite links. Its own module (ROK-1891) so the
 * hub overview can gate the setup checklist's Invite step without inlining the rest
 * of the invite helpers (expiry choices, row copy) into the `hub-page` route chunk.
 */
import type { HubCtx } from '../../../plugins/hub-module';

/** Live member of an active community hub ⇒ may make invite links (§8a(a)). */
export function canInvite(ctx: HubCtx): boolean {
    return ctx.page.community?.status === 'active' && ctx.page.viewer.role !== 'visitor';
}
