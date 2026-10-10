/**
 * PollPrivateBar (ROK-1750) — the private-poll row in the poll page header:
 * a "Private" chip, a Copy link control (the `Button` primitive — ROK-1646
 * guard; any participant may copy, ruling R2) and, for the creator / admin /
 * operator, Reset link behind a confirm. Renders only when the poll is
 * private AND the viewer was handed a token (a private community lineup
 * reports `visibility:'private'` with no token — nothing to share).
 */
import { useState, type JSX } from 'react';
import { LinkIcon } from '@heroicons/react/24/outline';
import type { SchedulePollPageResponseDto } from '@raid-ledger/contract';
import { useAuth, isOperatorOrAdmin } from '../../hooks/use-auth';
import { useResetPollShareToken } from '../../hooks/use-poll-share';
import { canBypassThreshold } from './threshold';
import { copyPollShareLink } from '../../lib/poll-share-redirect';
import { Modal } from '../../components/ui/modal';
import { Button } from '../../components/ui/button';

const RESET_COPY = "Anyone who hasn't opened the old link yet will need the new one. People already in the poll keep access.";

function ResetLinkConfirm({ isOpen, onClose, onConfirm, isPending }: {
    isOpen: boolean; onClose: () => void; onConfirm: () => void; isPending: boolean;
}): JSX.Element {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Reset link?" maxWidth="max-w-sm"
            footer={<div className="flex gap-2 justify-end">
                <Button variant="secondary" onClick={onClose}>Cancel</Button>
                <Button variant="destructive" onClick={onConfirm} loading={isPending} loadingLabel="Resetting…">Reset link</Button>
            </div>}>
            <p className="text-sm text-secondary">{RESET_COPY}</p>
        </Modal>
    );
}

function ResetLinkControl({ matchId }: { matchId: number }): JSX.Element {
    const [open, setOpen] = useState(false);
    const reset = useResetPollShareToken();
    const confirm = () => reset.mutate(matchId, { onSettled: () => setOpen(false) });
    return (
        <>
            <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="poll-share-reset">Reset link</Button>
            <ResetLinkConfirm isOpen={open} onClose={() => setOpen(false)} onConfirm={confirm} isPending={reset.isPending} />
        </>
    );
}

export function PollPrivateBar({ poll }: { poll: SchedulePollPageResponseDto }): JSX.Element | null {
    const { user } = useAuth();
    const token = poll.shareToken;
    if (poll.visibility !== 'private' || !token) return null;
    const canReset = isOperatorOrAdmin(user) || canBypassThreshold(user, poll.match);
    return (
        <div className="flex items-center gap-2 flex-wrap" data-testid="poll-private-bar">
            <span className="inline-flex px-2.5 py-1 text-xs font-medium rounded-full border bg-warning/10 text-warning border-warning/30">Private</span>
            <Button variant="secondary" size="sm" onClick={() => copyPollShareLink(token)}
                aria-label="Copy poll link" title="Copy poll link" data-testid="poll-share-copy">
                <LinkIcon className="w-4 h-4" aria-hidden="true" />
                Copy link
            </Button>
            {canReset && <ResetLinkControl matchId={poll.match.id} />}
        </div>
    );
}
