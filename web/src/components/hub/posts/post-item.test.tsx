/**
 * ROK-1868 V4 — one Posts-tab item: "Show more" only when the 6-line clamp
 * overflows (toggles `aria-expanded`), the Edited marker, the "In Discord"
 * pill + link, the deep-link copy, and editor-only actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/render-helpers';
import { buildHubPost } from '../../../test/factories/hub-posts';
import { PostItem } from './post-item';

const copyWithToast = vi.fn<(text: string) => Promise<boolean>>();
vi.mock('../../../lib/clipboard', () => ({ copyWithToast: (text: string) => copyWithToast(text) }));

const CLAMP_TESTID = 'hub-post-item-clamp';
let clampOverflows = false;

function stubHeights(): () => void {
    const proto = HTMLElement.prototype;
    const scroll = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
    const client = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
    Object.defineProperty(proto, 'scrollHeight', {
        configurable: true,
        get(this: HTMLElement) { return this.dataset['testid'] === CLAMP_TESTID && clampOverflows ? 400 : 100; },
    });
    Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 100 });
    return () => {
        if (scroll) Object.defineProperty(proto, 'scrollHeight', scroll);
        if (client) Object.defineProperty(proto, 'clientHeight', client);
    };
}

let restore: () => void = () => undefined;
beforeEach(() => { clampOverflows = false; copyWithToast.mockResolvedValue(true); restore = stubHeights(); });
afterEach(() => { restore(); copyWithToast.mockReset(); });

describe('PostItem (V4)', () => {
    it('shows no "Show more" when the body fits the clamp', () => {
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} />);
        expect(screen.queryByRole('button', { name: /show more/i }), 'a short post must not offer Show more').toBeNull();
    });

    it('offers "Show more" when the body overflows and toggles aria-expanded', async () => {
        clampOverflows = true;
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} />);
        const toggle = screen.getByRole('button', { name: /show more/i });
        expect(toggle).toHaveAttribute('aria-expanded', 'false');
        expect(toggle.getAttribute('aria-controls'), 'the toggle must point at the body').toBe(screen.getByTestId(CLAMP_TESTID).id);
        await userEvent.click(toggle);
        expect(screen.getByRole('button', { name: /show less/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('renders the Edited marker only for an edited post', () => {
        const editedBy = { userId: 2, displayName: 'Kara', avatarUrl: null };
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3, editedBy, updatedAt: '2026-10-04T12:00:00.000Z' })} canEdit={false} />);
        expect(screen.getByText(/Edited .* by Kara/)).toBeInTheDocument();
    });

    it('shows the "In Discord" pill and a "View in Discord" link for a relayed post', () => {
        const relay = { channelId: '900', messageUrl: 'https://discord.com/channels/1/900/55', relayedAt: '2026-10-03T12:00:01.000Z' };
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3, relay })} canEdit={false} />);
        expect(screen.getByText('In Discord')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /view in discord/i })).toHaveAttribute('href', relay.messageUrl);
    });

    it('copies the post deep link /guilds/7?post=3#posts', async () => {
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} />);
        await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
        expect(copyWithToast).toHaveBeenCalledWith(`${window.location.origin}/guilds/7?post=3#posts`);
    });

    it('gives Edit and Delete to editors only', () => {
        const { unmount } = renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} />);
        expect(screen.queryByRole('button', { name: /^edit/i }), 'a member must not see Edit').toBeNull();
        expect(screen.queryByRole('button', { name: /^delete/i }), 'a member must not see Delete').toBeNull();
        unmount();
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit />);
        expect(screen.getByRole('button', { name: /^edit/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^delete/i })).toBeInTheDocument();
    });

    it('opens the inline editor from Edit', async () => {
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit />);
        await userEvent.click(screen.getByRole('button', { name: /^edit/i }));
        expect(await screen.findByTestId('hub-post-editor')).toBeInTheDocument();
    });
});

describe('PostItem — deep-linked (ROK-1868 review MAJOR)', () => {
    it('a short highlighted post offers no Show more / Show less', () => {
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} highlighted />);
        expect(screen.queryByRole('button', { name: /show (more|less)/i }), 'a short deep-linked post must not offer a toggle').toBeNull();
    });

    it('a long highlighted post opens expanded with Show less', () => {
        clampOverflows = true;
        renderWithProviders(<PostItem guildId={7} post={buildHubPost({ id: 3 })} canEdit={false} highlighted />);
        expect(screen.getByRole('button', { name: /show less/i })).toHaveAttribute('aria-expanded', 'true');
    });
});
