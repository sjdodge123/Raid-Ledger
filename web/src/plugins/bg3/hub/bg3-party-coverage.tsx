/**
 * ROK-1958 (operator Q4) — the party coverage strip: healer / arcane / tank /
 * face, lit when any non-summon member's class (or subclass) gives the role
 * (`lib/bg3-party-roles.ts`, the table the operator vetoes on the PR).
 * Read-only `StatusChip`s: success = covered, neutral = a gap.
 */
import type { JSX } from 'react';
import type { Bg3PartySlot } from '@raid-ledger/contract';
import { StatusChip } from '../../../components/ui/status-chip';
import { coverage } from '../lib/bg3-party-roles';

export function Bg3PartyCoverage({ party }: { party: readonly Bg3PartySlot[] }): JSX.Element {
    return (
        <ul className="flex flex-wrap gap-1.5" aria-label="Party coverage" data-testid="bg3-party-coverage">
            {coverage(party).map((c) => (
                <li key={c.role} data-role={c.role} data-covered={c.covered ? 'true' : 'false'}>
                    <StatusChip tone={c.covered ? 'success' : 'neutral'} title={`${c.label}: ${c.covered ? 'covered' : 'no one in the party'}`}>
                        {c.covered && <span aria-hidden="true">✓ </span>}
                        {c.label}
                        <span className="sr-only">{c.covered ? ' covered' : ' missing'}</span>
                    </StatusChip>
                </li>
            ))}
        </ul>
    );
}
