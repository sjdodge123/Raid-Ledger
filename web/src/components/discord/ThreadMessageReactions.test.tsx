/**
 * ROK-1506 — `ThreadMessageReactions`, the read-only pills under a message.
 *
 * Pins the four ways the pills could go wrong: a `0`-count / empty-set render,
 * the custom-emoji url + alt construction, and the two hostile inputs (an id
 * that is not a snowflake, a name that is markup) — both of which must degrade
 * to TEXT, never to an element.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ThreadMessageReactionDto } from '@raid-ledger/contract';
import { ThreadMessageReactions } from './ThreadMessageReactions';

function reaction(
    over: Partial<ThreadMessageReactionDto> = {},
): ThreadMessageReactionDto {
    return {
        key: '🔥',
        name: '🔥',
        id: null,
        animated: false,
        count: 1,
        ...over,
    };
}

describe('ThreadMessageReactions', () => {
    it('renders nothing at all for an empty set (A1.7)', () => {
        const { container } = render(<ThreadMessageReactions reactions={[]} />);
        expect(
            container.firstChild,
            'an empty reaction set must not mount an empty container',
        ).toBeNull();
        expect(screen.queryByTestId('thread-message-reaction')).toBeNull();
    });

    it('renders a unicode reaction as text with its count (A1.7, A2.3)', () => {
        render(
            <ThreadMessageReactions reactions={[reaction({ count: 3 })]} />,
        );
        const pills = screen.getAllByTestId('thread-message-reaction');
        expect(pills).toHaveLength(1);
        expect(pills[0]).toHaveTextContent('🔥');
        expect(
            screen.getByTestId('thread-message-reaction-count'),
        ).toHaveTextContent('3');
        expect(
            pills[0].querySelector('img'),
            'a unicode emoji must be a text node, not an image',
        ).toBeNull();
    });

    it('renders a custom emoji as a CDN png with the name as alt (A2.1)', () => {
        render(
            <ThreadMessageReactions
                reactions={[
                    reaction({
                        key: '1234567890123456789',
                        id: '1234567890123456789',
                        name: 'pog',
                        count: 2,
                    }),
                ]}
            />,
        );
        const img = screen.getByRole('img', { name: 'pog' });
        expect(img).toHaveAttribute(
            'src',
            'https://cdn.discordapp.com/emojis/1234567890123456789.png?size=32',
        );
        expect(
            screen.getByTestId('thread-message-reaction-count'),
        ).toHaveTextContent('2');
    });

    it('uses the gif extension for an animated custom emoji (A2.2)', () => {
        render(
            <ThreadMessageReactions
                reactions={[
                    reaction({
                        key: '1234567890123456789',
                        id: '1234567890123456789',
                        name: 'pog',
                        animated: true,
                    }),
                ]}
            />,
        );
        expect(screen.getByRole('img', { name: 'pog' })).toHaveAttribute(
            'src',
            'https://cdn.discordapp.com/emojis/1234567890123456789.gif?size=32',
        );
    });

    it('degrades a non-snowflake id to the name as text — no img (A2.4)', () => {
        const hostile = '1\'"><script>';
        const { container } = render(
            <ThreadMessageReactions
                reactions={[reaction({ key: hostile, id: hostile, name: 'pog' })]}
            />,
        );
        expect(
            container.querySelector('img'),
            'a hostile id must never reach an img src',
        ).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        expect(screen.getByTestId('thread-message-reaction')).toHaveTextContent(
            'pog',
        );
    });

    it('renders a markup-shaped name as a literal string (A2.5)', () => {
        const markup = '<img src=x onerror=alert(1)>';
        const { container } = render(
            <ThreadMessageReactions
                reactions={[reaction({ key: markup, name: markup })]}
            />,
        );
        expect(
            container.querySelector('img'),
            'a markup-shaped name must be escaped, not parsed',
        ).toBeNull();
        expect(screen.getByText(markup)).toBeInTheDocument();
    });

    it('keeps the wire order and offers no interactive control', () => {
        const { container } = render(
            <ThreadMessageReactions
                reactions={[
                    reaction({ key: '👍', name: '👍', count: 4 }),
                    reaction({ key: '🔥', name: '🔥', count: 1 }),
                ]}
            />,
        );
        const pills = screen.getAllByTestId('thread-message-reaction');
        expect(pills.map((pill) => pill.textContent)).toEqual(['👍4', '🔥1']);
        expect(
            container.querySelector('button, a, [role="button"], [title]'),
            'the pills are read-only — no picker, no hover title, no link',
        ).toBeNull();
    });
});
