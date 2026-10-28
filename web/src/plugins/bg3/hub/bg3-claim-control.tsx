/**
 * ROK-1958 D-6 — the claim footer of a BG3 party tile ("that's me"). Direct,
 * no confirm: claims are cheap and reversible. Presentational — the widget
 * owns the optimistic mutations and passes `onClaim` / `onUnclaim`.
 *
 * - Unclaimed: "That's me" only while the viewer may claim (a member with no
 *   claim in this campaign); otherwise a quiet "Unclaimed".
 * - The viewer's own claim: avatar + "You" + "Not me".
 * - Someone else's: avatar + name; host / editor / staff also get a ×.
 */
import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { Bg3PartyClaim } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { AvatarWithFallback } from '../../../components/shared/AvatarWithFallback';

export interface Bg3ClaimControlProps {
    /** null for a slot that cannot be claimed (summons never render this). */
    readonly slotKey: string | null;
    readonly claim: Bg3PartyClaim | null;
    /** "Wood Elf Barbarian" — names the × for screen readers. */
    readonly slotLabel: string;
    readonly viewerId: number | null;
    /** A member who holds no claim in this campaign yet. */
    readonly canClaim: boolean;
    /** Campaign host, hub editor or staff. */
    readonly canRemoveOthers: boolean;
    readonly onClaim: (slotKey: string) => void;
    readonly onUnclaim: (slotKey: string) => void;
}

const FOOTER = 'mt-auto flex min-h-[44px] items-center gap-2 border-t border-edge-subtle pt-2';
const WHO = 'min-w-0 flex-1 truncate text-sm text-foreground';

function Claimant({ claim, label }: { claim: Bg3PartyClaim; label: string }): JSX.Element {
    return (
        <>
            <AvatarWithFallback avatarUrl={claim.avatarUrl} username={claim.displayName} sizeClassName="h-6 w-6" />
            <span className={WHO}>{label}</span>
        </>
    );
}

function Unclaimed({ canClaim, onClaim }: { canClaim: boolean; onClaim: () => void }): JSX.Element {
    return (
        <div className={FOOTER} data-testid="bg3-claim-control">
            {canClaim
                ? <Button variant="secondary" size="sm" onClick={onClaim}>That&apos;s me</Button>
                : <span className="text-sm text-dim">Unclaimed</span>}
        </div>
    );
}

export function Bg3ClaimControl(props: Bg3ClaimControlProps): JSX.Element | null {
    const { slotKey, claim, viewerId } = props;
    if (slotKey === null) return null;
    if (claim === null) return <Unclaimed canClaim={props.canClaim} onClaim={() => props.onClaim(slotKey)} />;
    if (viewerId !== null && claim.userId === viewerId) {
        return (
            <div className={FOOTER} data-testid="bg3-claim-control">
                <Claimant claim={claim} label="You" />
                <Button variant="ghost" size="sm" onClick={() => props.onUnclaim(slotKey)}>Not me</Button>
            </div>
        );
    }
    return (
        <div className={FOOTER} data-testid="bg3-claim-control">
            <Claimant claim={claim} label={claim.displayName} />
            {props.canRemoveOthers && (
                <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${claim.displayName}'s claim on ${props.slotLabel}`}
                    onClick={() => props.onUnclaim(slotKey)}>
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                </Button>
            )}
        </div>
    );
}
