/**
 * ROK-1868 W6 / D2 — confirm a hard delete: a `Modal` at ≥1024px, a
 * `BottomSheet` below (design-system §4.4). Closed → nothing mounted, so a
 * closed sheet's buttons never stay focusable off-screen.
 */
import type { JSX } from 'react';
import type { HubPost } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Modal } from '../../ui/modal';
import { BottomSheet } from '../../ui/bottom-sheet';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { useDeleteHubPost } from './use-hub-posts';

export interface DeletePostConfirmProps {
    guildId: number;
    post: HubPost;
    isOpen: boolean;
    onClose: () => void;
}

const TITLE = 'Delete this post?';

/** The §4.4 shell around the delete question; deleting closes it (the feed refetches). */
export function DeletePostConfirm({ guildId, post, isOpen, onClose }: DeletePostConfirmProps): JSX.Element | null {
    const Shell = useMediaQuery(DESKTOP_MQ) ? Modal : BottomSheet;
    const remove = useDeleteHubPost(guildId);
    if (!isOpen) return null;
    const footer = (
        <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>Keep post</Button>
            <Button variant="destructive" loading={remove.isPending} data-testid="hub-post-delete-confirm"
                onClick={() => remove.mutate(post.id, { onSuccess: onClose })}>Delete</Button>
        </div>
    );
    return (
        <Shell isOpen onClose={onClose} title={TITLE} footer={footer}>
            <div data-testid="hub-post-delete-dialog">
                <p className="text-sm text-secondary">
                    {post.relay ? 'It’s removed here and from Discord.' : 'It’s removed from this page.'} This can’t be undone.
                </p>
                {remove.isError && <p role="alert" className="mt-2 text-sm text-danger">Couldn’t delete the post. Try again.</p>}
            </div>
        </Shell>
    );
}
