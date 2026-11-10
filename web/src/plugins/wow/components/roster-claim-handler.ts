/**
 * ROK-2128 claim handler shared by the Guild-roster list and (ROK-2149) the
 * read-only roster-member page. Kept out of `roster-claim-actions.tsx` so that
 * file only exports components (react-refresh).
 */
import type { CharacterDto, RosterClaimCandidateDto, WowForeverSelectableRuleset } from '@raid-ledger/contract';
import { toast } from '../../../lib/toast';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useClaimRosterMember } from '../hooks/use-roster-claim';

/** The row fields a claim needs. */
export type ClaimTarget = Pick<RosterClaimCandidateDto, 'memberId' | 'name'>;

/**
 * One claim code path (ROK-2128): the row's Claim and, ROK-2149, the roster-member
 * page's "Claim this character" both call this. `onClaimed` gets the new character.
 */
export function useClaimHandler(gameId: number, existing: CharacterDto[], ruleset: WowForeverSelectableRuleset, onClaimed: (created: CharacterDto) => void) {
    const claim = useClaimRosterMember(gameId);
    const isMain = !existing.some((c) => c.isMain);
    const onClaim = (c: ClaimTarget): void => {
        claim.mutate({ memberId: c.memberId, body: { ruleset, isMain } }, {
            onSuccess: (created) => { toast.success(`${c.name} is now yours.`); onClaimed(created); },
            onError: (e) => { toast.error(httpStatusOf(e) === 409 ? 'Someone claimed this first' : e.message || 'Could not claim this character'); },
        });
    };
    return { onClaim, pendingId: claim.isPending ? claim.variables?.memberId ?? null : null };
}
