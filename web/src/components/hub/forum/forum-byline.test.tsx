/** ROK-2208 R2 — Discord-origin forum messages: guest name + "via Discord" chip. */
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders as render } from '../../../test/render-helpers';
import { buildForumReply, buildForumThread } from '../../../test/factories/hub-forum';
import { forumByline } from './forum-byline';
import { ForumMessage } from './forum-message';
import { forumAuthorAvatarUrl, forumAuthorName, forumRowMeta, forumRowPreview } from './forum-thread.helpers';

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

describe('ROK-2328 — a banned or deactivated author', () => {
    const BANNED = { userId: 5, displayName: 'Banhammered', avatarUrl: 'https://cdn.example/a.png', blocked: 'banned' as const };
    const DEACTIVATED = { ...BANNED, displayName: 'LeftGuild', blocked: 'deactivated' as const };

    it.each([BANNED, DEACTIVATED])('forumByline shows "Deactivated member" with no avatar ($blocked)', (author) => {
        expect(forumByline({ author, source: 'discord' }))
            .toEqual({ name: 'Deactivated member', avatarUrl: null, viaDiscord: true });
    });
    it('forumAuthorName / forumAuthorAvatarUrl hide the blocked author', () => {
        expect(forumAuthorName(BANNED)).toBe('Deactivated member');
        expect(forumAuthorAvatarUrl(DEACTIVATED)).toBeNull();
        expect(forumAuthorAvatarUrl({ ...BANNED, blocked: null })).toBe('https://cdn.example/a.png');
    });
    it('a thread row and its latest-reply preview name no blocked author', () => {
        const thread = buildForumThread({ author: BANNED, latestReply: { author: DEACTIVATED, preview: 'hi' } });
        expect(forumRowMeta(thread)).toMatch(/^Deactivated member · /);
        expect(forumRowPreview(thread)).toBe('Deactivated member: hi');
    });
    it('ForumMessage renders "Deactivated member", never the account name or avatar', () => {
        const { container } = render(<ForumMessage testId="m" message={buildForumReply({ author: BANNED })} />);
        expect(screen.getByText('Deactivated member')).toBeInTheDocument();
        expect(screen.queryByText('Banhammered')).not.toBeInTheDocument();
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('a')).toBeNull();
    });
});
