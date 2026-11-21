/**
 * ROK-2274 — a `kind: 'signup_line'` reply renders as a muted one-line system
 * row: no avatar, no byline, no edit; the "⋯" Delete only when the server
 * grants `can.delete` (officers). A normal reply keeps the full message card.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useMutation } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { HubForumReply } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildForumReply } from '../../../test/factories/hub-forum';
import { ForumReplyItemView } from './forum-thread-items';
import type { ReplyDeleteVars, ReplyEditVars } from './use-hub-forum';

const OFFICER = { edit: true, delete: true, pin: false };
const LINE = buildForumReply({ id: 40, kind: 'signup_line', author: null, body: '✅ Mirelle signed up as Healer' });

function Harness({ reply, onDelete }: { reply: HubForumReply; onDelete?: (v: ReplyDeleteVars) => void }): JSX.Element {
    const update = useMutation<HubForumReply, Error, ReplyEditVars>({ mutationFn: () => Promise.resolve(reply) });
    const remove = useMutation<void, Error, ReplyDeleteVars>({ mutationFn: (v) => { onDelete?.(v); return Promise.resolve(); } });
    return <ul><ForumReplyItemView threadId={5} reply={reply} highlighted={false} update={update} remove={remove} /></ul>;
}

describe('ForumReplyItemView — signup lines (ROK-2274)', () => {
    it('renders a signup line as a one-line row without avatar or byline', () => {
        renderWithProviders(<Harness reply={LINE} />);
        const row = screen.getByTestId('forum-signup-line');
        expect(screen.getByTestId('forum-signup-line-text')).toHaveTextContent('✅ Mirelle signed up as Healer');
        expect(screen.getByTestId('forum-signup-line-time')).toHaveAttribute('datetime', LINE.createdAt);
        expect(row.querySelector('img')).toBeNull();
        expect(row).toHaveAttribute('id', 'forum-reply-40');
        expect(screen.queryByTestId('forum-reply')).toBeNull();
    });

    it('shows no "⋯" menu to a member the server does not let delete', () => {
        renderWithProviders(<Harness reply={LINE} />);
        expect(screen.queryByTestId('forum-signup-line-actions')).toBeNull();
    });

    it('gives an officer Delete only — never Edit — and deletes the line', async () => {
        const onDelete = vi.fn();
        renderWithProviders(<Harness reply={{ ...LINE, can: OFFICER }} onDelete={onDelete} />);
        await userEvent.click(screen.getByTestId('forum-signup-line-actions'));
        expect(screen.queryByRole('menuitem', { name: /edit/i })).toBeNull();
        await userEvent.click(screen.getByRole('menuitem', { name: /delete/i }));
        expect(screen.getByText('Delete this signup line?')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));
        expect(onDelete).toHaveBeenCalledWith({ threadId: 5, replyId: 40 });
    });

    it('still renders a normal reply as the full message card', () => {
        renderWithProviders(<Harness reply={buildForumReply({ kind: 'reply', can: OFFICER })} />);
        expect(screen.getByTestId('forum-reply')).toHaveTextContent('Mossbeard');
        expect(screen.getByTestId('forum-reply-body')).toHaveTextContent('I can swap to resto.');
        expect(screen.queryByTestId('forum-signup-line')).toBeNull();
    });
});
