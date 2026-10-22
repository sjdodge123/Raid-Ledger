/**
 * ROK-1868 W5 — the `?post=<id>` target when it isn't on the feed's first
 * page: fetched on its own and shown above the feed, expanded + highlighted.
 * A 404 (deleted, or another hub's post) reads "This post was removed.".
 */
import type { JSX } from 'react';
import { httpStatusOf } from '../../../lib/api/api-error';
import { QuietEmpty } from '../card-bits';
import { PostItem } from './post-item';
import { useHubPost } from './use-hub-posts';

export interface LinkedPostProps { guildId: number; postId: number; canEdit: boolean; removedCopy: string }

/** The deep-linked post, its removed notice, or nothing while it loads / on other errors. */
export function LinkedPost({ guildId, postId, canEdit, removedCopy }: LinkedPostProps): JSX.Element | null {
    const one = useHubPost(guildId, postId);
    if (httpStatusOf(one.error) === 404) {
        return <div data-testid="hub-post-removed"><QuietEmpty>{removedCopy}</QuietEmpty></div>;
    }
    if (!one.data) return null;
    return (
        <div className="mb-4" data-testid="hub-post-linked">
            {/* Keyed by id: moving to another cached post must reset edit / delete state (Codex r3). */}
            <PostItem key={one.data.id} guildId={guildId} post={one.data} canEdit={canEdit} highlighted />
        </div>
    );
}
