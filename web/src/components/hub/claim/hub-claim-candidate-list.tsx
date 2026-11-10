/**
 * ROK-2153 S3b — the claim candidates list, opened from the core claim prompt:
 * `Modal` at ≥1024px, `BottomSheet` below (§4.4). One row per unclaimed
 * character with its own Claim button; a provider's options step (WoW: the
 * ruleset) replaces the list once a candidate is picked. A failed claim shows
 * a §4.7 status banner above the list, never a toast (AC 4).
 */
import type { ComponentType, JSX, ReactNode } from 'react';
import type { HubClaimCandidate, HubClaimStatus } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { HUB_CLAIM_TEXT, type HubClaimErrorView } from './hub-claim-copy';
import type { HubClaimOptionsStepProps } from './hub-claim-providers';

const BANNER_TONE: Record<HubClaimErrorView['tone'], string> = {
    warning: 'bg-warning/10 border-warning/30 text-warning',
    danger: 'bg-danger/10 border-danger/30 text-danger',
};

/** §4.7 status banner for a failed claim. */
export function HubClaimErrorBanner({ view }: { view: HubClaimErrorView }): JSX.Element {
    return (
        <p role="alert" data-testid="hub-claim-error"
            className={`rounded-lg border p-3 text-sm ${BANNER_TONE[view.tone]}`}>
            {view.message}
        </p>
    );
}

/** The candidate's picture, or its initial on a neutral disc. Decorative: the name is always beside it. */
export function HubClaimAvatar({ candidate }: { candidate: HubClaimCandidate }): JSX.Element {
    if (candidate.avatarUrl !== null) {
        return <img src={candidate.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-edge object-cover" />;
    }
    return (
        <span aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-edge bg-panel text-sm font-semibold text-secondary">
            {candidate.name.slice(0, 1).toUpperCase()}
        </span>
    );
}

/** Avatar + name + subtitle; shared by the list rows and the prompt's suggested match. */
export function HubClaimIdentity({ candidate }: { candidate: HubClaimCandidate }): JSX.Element {
    return (
        <div className="flex min-w-0 items-center gap-3">
            <HubClaimAvatar candidate={candidate} />
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">{candidate.name}</p>
                {candidate.subtitle !== null && <p className="truncate text-xs text-muted">{candidate.subtitle}</p>}
            </div>
        </div>
    );
}

interface RowsProps {
    status: HubClaimStatus;
    pendingId: string | null;
    onClaim: (candidate: HubClaimCandidate) => void;
}

function CandidateRows({ status, pendingId, onClaim }: RowsProps): JSX.Element {
    if (status.candidates.length === 0) return <p className="text-sm text-muted">{HUB_CLAIM_TEXT.empty}</p>;
    return (
        <>
            <ul className="divide-y divide-edge" data-testid="hub-claim-candidates">
                {status.candidates.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                        <HubClaimIdentity candidate={c} />
                        <Button variant="secondary" aria-label={HUB_CLAIM_TEXT.claimNamed(c.name)}
                            loading={pendingId === c.id} disabled={pendingId !== null && pendingId !== c.id}
                            onClick={() => { onClaim(c); }}>
                            {HUB_CLAIM_TEXT.rowClaim}
                        </Button>
                    </li>
                ))}
            </ul>
            {status.truncated && (
                <p className="mt-2 text-xs text-muted">{HUB_CLAIM_TEXT.truncated(status.candidates.length, status.unclaimedCount)}</p>
            )}
        </>
    );
}

export interface HubClaimOptionsState {
    readonly candidate: HubClaimCandidate;
    readonly OptionsStep: ComponentType<HubClaimOptionsStepProps>;
    readonly onSubmit: (options: Record<string, unknown>) => void;
    readonly onCancel: () => void;
}

export interface HubClaimCandidateListProps extends RowsProps {
    readonly isOpen: boolean;
    readonly onClose: () => void;
    readonly guildId: number;
    readonly error: HubClaimErrorView | null;
    /** Set once a candidate is picked and the provider needs options. */
    readonly options: HubClaimOptionsState | null;
}

function ListBody(props: HubClaimCandidateListProps): JSX.Element {
    const { options, error, guildId, pendingId } = props;
    return (
        <div className="flex flex-col gap-3">
            {error !== null && <HubClaimErrorBanner view={error} />}
            {options === null
                ? <CandidateRows status={props.status} pendingId={pendingId} onClaim={props.onClaim} />
                : <options.OptionsStep guildId={guildId} candidate={options.candidate} onSubmit={options.onSubmit}
                    onCancel={options.onCancel} pending={pendingId !== null} />}
        </div>
    );
}

function Overlay({ isOpen, onClose, busy, children }: { isOpen: boolean; onClose: () => void; busy: boolean; children: ReactNode }): JSX.Element {
    const desktop = useMediaQuery(DESKTOP_MQ);
    if (desktop) {
        return <Modal isOpen={isOpen} onClose={onClose} title={HUB_CLAIM_TEXT.listTitle} maxWidth="max-w-lg" closeDisabled={busy}>{children}</Modal>;
    }
    return <BottomSheet isOpen={isOpen} onClose={onClose} title={HUB_CLAIM_TEXT.listTitle} maxHeight="85vh" closeDisabled={busy}>{children}</BottomSheet>;
}

/** The overlay; state lives in the prompt (`hub-claim-prompt.tsx`). */
export function HubClaimCandidateList(props: HubClaimCandidateListProps): JSX.Element {
    return (
        <Overlay isOpen={props.isOpen} onClose={props.onClose} busy={props.pendingId !== null}>
            <ListBody {...props} />
        </Overlay>
    );
}
