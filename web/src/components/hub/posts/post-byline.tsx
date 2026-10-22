/** ROK-1868 — author avatar + name + "Posted … · Edited … by …" (W1–W3). */
import type { JSX } from 'react';
import type { HubPost } from '@raid-ledger/contract';
import { AvatarWithFallback } from '../../shared/AvatarWithFallback';
import { postMeta } from './hub-post.helpers';

export function PostByline({ post, testId }: { post: HubPost; testId?: string }): JSX.Element {
    const author = post.author.displayName ?? 'A former member';
    return (
        <div className="flex items-center gap-2" data-testid={testId}>
            <AvatarWithFallback username={author} avatarUrl={post.author.avatarUrl} sizeClassName="h-8 w-8" alt="" />
            <p className="text-sm">
                <span className="font-semibold text-foreground">{author}</span>
                <span className="block text-xs text-dim">{postMeta(post)}</span>
            </p>
        </div>
    );
}
