/**
 * ROK-2128 claim pieces shared by the Guild-roster list and (ROK-2149) the
 * read-only roster-member page: the Ruleset select and the claim handler.
 */
import type { JSX } from 'react';
import {
    WOW_FOREVER_RULESET_LABELS,
    WOW_FOREVER_SELECTABLE_RULESETS,
    type CharacterDto,
    type RosterClaimCandidateDto,
    type WowForeverSelectableRuleset,
} from '@raid-ledger/contract';
import { Field } from '../../../components/ui/field';
import { Select } from '../../../components/ui/select';
import { toast } from '../../../lib/toast';
import { httpStatusOf } from '../../../lib/api/api-error';
import { useClaimRosterMember } from '../hooks/use-roster-claim';

/** The row fields a claim needs. */
export type ClaimTarget = Pick<RosterClaimCandidateDto, 'memberId' | 'name'>;

export function RulesetSelect({ value, onChange }: { value: WowForeverSelectableRuleset; onChange: (r: WowForeverSelectableRuleset) => void }): JSX.Element {
    return (
        <Field label="Ruleset">
            <Select value={value} onChange={(e) => {
                const next = WOW_FOREVER_SELECTABLE_RULESETS.find((r) => r === e.target.value);
                if (next) onChange(next);
            }}>
                {WOW_FOREVER_SELECTABLE_RULESETS.map((r) => <option key={r} value={r}>{WOW_FOREVER_RULESET_LABELS[r]}</option>)}
            </Select>
        </Field>
    );
}

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

