/**
 * ROK-1175 — confirm removing a thread or reply: a `Modal` at ≥1024px, a
 * `BottomSheet` below (§4.4, the `delete-post-confirm.tsx` wording). Closed →
 * nothing mounted. The caller owns the mutation (thread vs reply).
 */
import type { JSX } from 'react';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';

export interface ForumDeleteConfirmProps {
    what: 'thread' | 'reply';
    isOpen: boolean;
    pending: boolean;
    failed: boolean;
    onConfirm: () => void;
    onClose: () => void;
}

const COPY = {
    thread: { title: 'Delete this thread?', keep: 'Keep thread', note: 'Its replies stay readable.' },
    reply: { title: 'Delete this reply?', keep: 'Keep reply', note: '' },
} as const;

/** The §4.4 shell around the delete question. */
export function ForumDeleteConfirm({ what, isOpen, pending, failed, onConfirm, onClose }: ForumDeleteConfirmProps): JSX.Element | null {
    const Shell = useMediaQuery(DESKTOP_MQ) ? Modal : BottomSheet;
    if (!isOpen) return null;
    const copy = COPY[what];
    const footer = (
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>{copy.keep}</Button>
            <Button variant="destructive" loading={pending} data-testid="forum-delete-confirm" onClick={onConfirm}>Delete</Button>
        </div>
    );
    return (
        <Shell isOpen onClose={onClose} title={copy.title} footer={footer}>
            <div data-testid="forum-delete-dialog">
                <p className="text-sm text-secondary">It’s removed from this page. This can’t be undone. {copy.note}</p>
                {failed && <p role="alert" className="mt-2 text-sm text-danger">Couldn’t delete it. Try again.</p>}
            </div>
        </Shell>
    );
}
