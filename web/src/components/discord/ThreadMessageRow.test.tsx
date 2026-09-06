/**
 * ROK-1483 — `ThreadMessageRow`.
 *
 * Covers the three things the row can get wrong in a way nothing else catches:
 * the avatar fallback (both null-url and load-failure paths), the `(edited)`
 * marker, and the hardening on attachment anchors.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ThreadMessageDto } from '@raid-ledger/contract';
import { ThreadMessageRow } from './ThreadMessageRow';

const NOW = new Date('2026-09-05T12:00:00.000Z');

function makeMessage(
    overrides: Partial<ThreadMessageDto> = {},
): ThreadMessageDto {
    return {
        messageId: '1000',
        author: {
            discordUserId: '42',
            displayName: 'Alice Bee',
            avatarUrl: 'https://cdn.test/a.png',
        },
        content: 'hello there',
        attachments: [],
        mentions: [],
        createdAt: '2026-09-05T11:55:00.000Z',
        editedAt: null,
        ...overrides,
    };
}

describe('ThreadMessageRow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders the avatar image when a url is present', () => {
        render(<ThreadMessageRow message={makeMessage()} />);
        expect(screen.getByTestId('thread-message-avatar')).toHaveAttribute(
            'src',
            'https://cdn.test/a.png',
        );
        expect(screen.queryByTestId('thread-message-initials')).toBeNull();
    });

    it('falls back to initials when the author has no avatar url', () => {
        render(
            <ThreadMessageRow
                message={makeMessage({
                    author: {
                        discordUserId: '42',
                        displayName: 'Alice Bee',
                        avatarUrl: null,
                    },
                })}
            />,
        );
        expect(screen.getByTestId('thread-message-initials').textContent).toBe(
            'AB',
        );
        expect(screen.queryByTestId('thread-message-avatar')).toBeNull();
    });

    it('falls back to initials when the avatar image fails to load', () => {
        render(<ThreadMessageRow message={makeMessage()} />);
        fireEvent.error(screen.getByTestId('thread-message-avatar'));
        expect(screen.getByTestId('thread-message-initials').textContent).toBe(
            'AB',
        );
        expect(screen.queryByTestId('thread-message-avatar')).toBeNull();
    });

    it('shows the author name and a relative timestamp', () => {
        render(<ThreadMessageRow message={makeMessage()} />);
        expect(screen.getByText('Alice Bee')).toBeInTheDocument();
        expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    });

    it('marks an edited message and leaves an unedited one unmarked', () => {
        const { unmount } = render(
            <ThreadMessageRow message={makeMessage()} />,
        );
        expect(screen.queryByTestId('thread-message-edited')).toBeNull();
        unmount();
        render(
            <ThreadMessageRow
                message={makeMessage({ editedAt: '2026-09-05T11:58:00.000Z' })}
            />,
        );
        expect(screen.getByTestId('thread-message-edited').textContent).toBe(
            '(edited)',
        );
    });

    it('renders content through the safe tokenizer, resolving mentions', () => {
        const { container } = render(
            <ThreadMessageRow
                message={makeMessage({
                    content: 'ping <@7> <script>alert(1)</script>',
                    mentions: [{ id: '7', kind: 'user', displayName: 'Bob' }],
                })}
            />,
        );
        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByTestId('discord-text').textContent).toBe(
            'ping @Bob <script>alert(1)</script>',
        );
    });

    it('links an https attachment with target and rel hardening', () => {
        render(
            <ThreadMessageRow
                message={makeMessage({
                    attachments: [
                        {
                            name: 'map.png',
                            url: 'https://cdn.test/map.png?ex=1',
                        },
                    ],
                })}
            />,
        );
        const anchor = screen.getByRole('link', { name: 'map.png' });
        expect(anchor).toHaveAttribute('href', 'https://cdn.test/map.png?ex=1');
        expect(anchor).toHaveAttribute('target', '_blank');
        expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('refuses to anchor an attachment whose protocol is not allow-listed', () => {
        const { container } = render(
            <ThreadMessageRow
                message={makeMessage({
                    attachments: [{ name: 'evil', url: 'javascript:alert(1)' }],
                })}
            />,
        );
        const anchor = container.querySelector('a');
        expect(
            anchor ? anchor.getAttribute('href') : null,
            'an attachment url must clear the same protocol allow-list as body links',
        ).toBeNull();
        expect(
            screen.getByTestId('thread-message-attachment').textContent,
        ).toBe('evil');
    });
});
