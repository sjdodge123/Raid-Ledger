/**
 * Tests for the poll page's vote-source capture (ROK-1550).
 *
 * The Discord poll card deep-links `?src=discord`, and every vote cast during
 * that visit is attributed to it. Two properties are pinned here: ANY value
 * that is not exactly `discord` maps to `'web'` (the server 400s an unknown
 * source, so a raw URL value must never be forwarded), and the captured value
 * survives the page rewriting its own query string mid-visit — the game-time
 * check and the lock deep-link both call `setSearchParams`.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter, useNavigate, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { voteSourceFromParam, useVoteSource } from '../use-vote-source';

describe('voteSourceFromParam', () => {
    it('maps exactly "discord" to the discord source', () => {
        expect(voteSourceFromParam('discord')).toBe('discord');
    });

    it.each([null, '', 'Discord', 'web', 'bogus', 'discord '])(
        'maps %p to the web source',
        (value) => {
            expect(voteSourceFromParam(value)).toBe('web');
        },
    );
});

describe('useVoteSource', () => {
    /** Render the hook under a router at `url`, exposing `setSearchParams`. */
    function renderAt(url: string) {
        const wrapper = ({ children }: { children: ReactNode }) => (
            <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
        );
        return renderHook(
            () => ({ source: useVoteSource(), params: useSearchParams() }),
            { wrapper },
        );
    }

    it('reads the discord source off the ?src param', () => {
        expect(renderAt('/p?src=discord').result.current.source).toBe('discord');
    });

    it('defaults to web with no param', () => {
        expect(renderAt('/p').result.current.source).toBe('web');
    });

    it('keeps the captured source when the query string is rewritten mid-visit', () => {
        const { result } = renderAt('/p?src=discord');
        act(() => result.current.params[1]({ gt: '1' }));
        expect(result.current.params[0].get('src')).toBeNull();
        expect(result.current.source).toBe('discord');
    });

    /**
     * Review fix (ROK-1550): the capture is PER POLL, not per mount.
     *
     * React Router reuses the component instance across an in-app link from
     * one poll to another, so a mount-only capture kept attributing poll B's
     * votes to the card that linked poll A.
     */
    describe('client-side navigation to another poll', () => {
        /** Render the hook once, exposing an in-router `navigate`. */
        function renderNavigable(url: string) {
            const wrapper = ({ children }: { children: ReactNode }) => (
                <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
            );
            return renderHook(
                () => ({
                    source: useVoteSource(),
                    navigate: useNavigate(),
                    params: useSearchParams(),
                }),
                { wrapper },
            );
        }

        it('drops a stale discord source when the route changes to an un-sourced poll', () => {
            const { result } = renderNavigable(
                '/lineups/1/schedule/500?src=discord',
            );
            expect(result.current.source).toBe('discord');

            act(() => result.current.navigate('/lineups/1/schedule/501'));

            expect(result.current.source).toBe('web');
        });

        it('picks up a discord source on the poll that was opened with it', () => {
            const { result } = renderNavigable('/lineups/1/schedule/500');
            expect(result.current.source).toBe('web');

            act(() =>
                result.current.navigate('/lineups/1/schedule/501?src=discord'),
            );

            expect(result.current.source).toBe('discord');
        });

        it('keeps the source across a search-only rewrite after a navigation', () => {
            const { result } = renderNavigable('/lineups/1/schedule/500');
            act(() =>
                result.current.navigate('/lineups/1/schedule/501?src=discord'),
            );

            act(() => result.current.params[1]({ gt: '1' }));

            expect(result.current.params[0].get('src')).toBeNull();
            expect(result.current.source).toBe('discord');
        });
    });
});
