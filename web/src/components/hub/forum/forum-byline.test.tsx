/** ROK-2208 R2 — Discord-origin forum messages: guest name + "via Discord" chip. */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '../../../test/render-helpers';
import { buildForumReply, buildForumThread } from '../../../test/factories/hub-forum';
import { forumByline } from './forum-byline';
import { ForumMessage } from './forum-message';
import { forumRowMeta } from './forum-thread.helpers';

const GUEST = { name: 'Thrall#discord', avatarUrl: null };

describe('forumByline', () => {
    it('shows a Discord guest under their Discord name with the chip', () => {
        expect(forumByline({ author: null, source: 'discord', discordAuthor: GUEST }))
            .toEqual({ name: 'Thrall#discord', avatarUrl: null, viaDiscord: true });
    });
    it('shows a linked member posting from Discord as themselves, still with the chip', () => {
        const reply = buildForumReply({ source: 'discord' });
        expect(forumByline(reply)).toMatchObject({ name: reply.author?.displayName, viaDiscord: true });
    });
    it('keeps "Former member" and no chip for a deleted RL author', () => {
        expect(forumByline({ author: null })).toEqual({ name: 'Former member', avatarUrl: null, viaDiscord: false });
    });
    it('names the guest in a thread row meta line', () => {
        expect(forumRowMeta(buildForumThread({ author: null, source: 'discord', discordAuthor: GUEST }))).toMatch(/^Thrall#discord · /);
    });
});

describe('ForumMessage — via Discord chip', () => {
    it('renders the guest name and the chip', () => {
        render(<ForumMessage testId="m" message={buildForumReply({ author: null, source: 'discord', discordAuthor: GUEST })} />);
        expect(screen.getByText('Thrall#discord')).toBeInTheDocument();
        expect(screen.getByText('via Discord')).toBeInTheDocument();
    });
    it('shows no chip on a Raid Ledger message', () => {
        render(<ForumMessage testId="m" message={buildForumReply({ source: 'raidledger' })} />);
        expect(screen.queryByText('via Discord')).not.toBeInTheDocument();
    });
});
