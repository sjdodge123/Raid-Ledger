/**
 * ROK-2149 — WoW filler for `character-detail:read-only-actions`: the "Claim this
 * character" CTA on a read-only roster member's page, shown only with `canClaim`.
 * Opened from a claim list (`?from=claim`) it reads as the confirm step — "This is
 * my character — claim it" + Back. ONE claim code path: the Guild-roster list's
 * Ruleset select and claim handler (`roster-claim-actions.tsx`).
 */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { WowForeverSelectableRuleset } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { useMyCharacters } from '../../../hooks/use-characters';
import { defaultClaimRuleset } from '../lib/roster-claim';
import { RulesetSelect, useClaimHandler } from '../components/roster-claim-actions';

export interface CharacterDetailReadOnlyActionsProps {
    rosterMemberId: number;
    canClaim: boolean;
    fromClaim: boolean;
    gameId: number;
    name: string;
}

function RosterMemberClaimCta({ rosterMemberId, fromClaim, gameId, name }: Omit<CharacterDetailReadOnlyActionsProps, 'canClaim'>): JSX.Element {
    const navigate = useNavigate();
    const existing = useMyCharacters(gameId).data?.data ?? [];
    const [picked, setPicked] = useState<WowForeverSelectableRuleset | null>(null);
    const ruleset = picked ?? defaultClaimRuleset(existing);
    const { onClaim, pendingId } = useClaimHandler(gameId, existing, ruleset, (created) => navigate(`/characters/${created.id}`, { replace: true }));
    const pending = pendingId !== null;
    return (
        <div data-testid="roster-member-claim" className="col-span-full flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
            <RulesetSelect value={ruleset} onChange={setPicked} />
            <Button variant="primary" loading={pending} loadingLabel="Claiming…" onClick={() => onClaim({ memberId: rosterMemberId, name })}>
                {fromClaim ? 'This is my character — claim it' : 'Claim this character'}
            </Button>
            {fromClaim && <Button variant="secondary" onClick={() => navigate(-1)}>Back</Button>}
        </div>
    );
}

export function CharacterDetailReadOnlyActions({ canClaim, ...rest }: CharacterDetailReadOnlyActionsProps): JSX.Element | null {
    return canClaim ? <RosterMemberClaimCta {...rest} /> : null;
}
