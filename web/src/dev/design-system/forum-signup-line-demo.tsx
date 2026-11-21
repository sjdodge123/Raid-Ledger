/**
 * Forum signup line for /dev/design-system (docs/design-system.md §3.2, ROK-2274).
 *
 * Renders the real `ForumReplyItemView` over a member reply and two
 * `kind: 'signup_line'` rows, one with the officer "⋯" Delete. The writes are
 * no-op mutations. Tokens only, so it flips with the colour family.
 */
import type { JSX } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { HubForumReply } from '@raid-ledger/contract';
import { ForumReplyItemView } from '../../components/hub/forum/forum-thread-items';
import type { ReplyDeleteVars, ReplyEditVars } from '../../components/hub/forum/use-hub-forum';
import { StateFrame } from './design-system-bits';

const AGO = (min: number): string => new Date(Date.now() - min * 60_000).toISOString();
const NONE = { edit: false, delete: false, pin: false };
const BASE = { editedAt: null, deleted: null, source: 'raidledger' as const };

const ROWS: HubForumReply[] = [
    { ...BASE, id: 1, kind: 'signup_line', author: null, body: '✅ Mirelle signed up as Healer', createdAt: AGO(42), can: { ...NONE, delete: true } },
    { ...BASE, id: 2, kind: 'reply', author: { userId: 2, displayName: 'Mossbeard', avatarUrl: null }, body: 'I can swap to resto.', createdAt: AGO(30), can: NONE },
    { ...BASE, id: 3, kind: 'signup_line', author: null, body: '❌ Thornwick withdrew', createdAt: AGO(5), can: NONE },
];

/** One frame: a reply between two signup lines (the first shows the officer menu). */
export function ForumSignupLineDemo(): JSX.Element {
    const update = useMutation<HubForumReply, Error, ReplyEditVars>({ mutationFn: () => Promise.reject(new Error('demo')) });
    const remove = useMutation<void, Error, ReplyDeleteVars>({ mutationFn: () => Promise.resolve() });
    return (
        <StateFrame label="Forum signup line — system row" note="forum-signup-line.tsx: kind 'signup_line' replies; muted one line, no avatar, officer Delete only.">
            <ul className="flex w-full flex-col gap-2" data-testid="ds-forum-signup-line">
                {ROWS.map((r) => <ForumReplyItemView key={r.id} threadId={1} reply={r} highlighted={false} update={update} remove={remove} />)}
            </ul>
        </StateFrame>
    );
}
