/**
 * Lineup persona resolver (ROK-1209).
 *
 * Resolution rules (in order):
 *   1. operator/admin who is the lineup creator → 'organizer'
 *   2. operator/admin (not creator) → 'admin'
 *   3. cannot participate (private lineup, not invited) → 'uninvited'
 *   4. has acted in the current phase → 'invitee-acted'
 *   5. otherwise → 'invitee-not-acted'
 */
import { canParticipateInLineup } from './lineup-eligibility';
import type { EligibilityLineup } from './lineup-eligibility';

export type Persona =
    | 'invitee-not-acted'
    | 'invitee-acted'
    | 'organizer'
    | 'admin'
    | 'uninvited';

interface PersonaUser {
    id: number;
    role?: string;
}

// ROK-1349: share the detail-pinned eligibility shape so a summary DTO
// (no createdBy / invitees) can't be passed into persona resolution either.
type PersonaLineup = EligibilityLineup;

function isOpRole(user: PersonaUser | null | undefined): boolean {
    return user?.role === 'operator' || user?.role === 'admin';
}

export function getLineupPersona(
    lineup: PersonaLineup,
    user: PersonaUser | null | undefined,
    hasActed: boolean,
): Persona {
    if (user && isOpRole(user) && lineup.createdBy.id === user.id) {
        return 'organizer';
    }
    if (user && isOpRole(user)) return 'admin';
    if (!canParticipateInLineup(lineup, user)) return 'uninvited';
    return hasActed ? 'invitee-acted' : 'invitee-not-acted';
}
