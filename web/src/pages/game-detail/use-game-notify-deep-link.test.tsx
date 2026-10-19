/**
 * ROK-1845 — the game page's `?notif=` deep link marks a notification read
 * only when the value is a UUID, and strips the param either way.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { createElement, type ReactNode } from 'react';

const markRead = vi.fn();
vi.mock('../../hooks/use-notifications', () => ({ useNotifications: () => ({ markRead }) }));

import { useGameNotifyDeepLink } from './use-game-notify-deep-link';

const UUID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const HOSTILE = '..%2Fadmin%2Fsettings%2Foauth%2Fclear%23';
const openPanel = vi.fn();

function run(url: string, ready = true) {
    const wrapper = ({ children }: { children: ReactNode }) =>
        createElement(MemoryRouter, { initialEntries: [url] }, children);
    return renderHook(() => {
        useGameNotifyDeepLink(ready, openPanel);
        return useLocation().search;
    }, { wrapper });
}

describe('useGameNotifyDeepLink — notif validation (ROK-1845)', () => {
    beforeEach(() => { markRead.mockClear(); openPanel.mockClear(); });

    it('does not mark a path-traversal value read, but strips it', () => {
        const { result } = run(`/games/7?tab=x&notif=${HOSTILE}`);
        expect(markRead).not.toHaveBeenCalled();
        expect(result.current).toBe('?tab=x');
    });

    it('still opens the panel when the notif value is invalid', () => {
        const { result } = run(`/games/7?action=notifications&notif=${HOSTILE}`);
        expect(markRead).not.toHaveBeenCalled();
        expect(openPanel).toHaveBeenCalledTimes(1);
        expect(result.current).toBe('');
    });

    it('marks a UUID read and strips it', () => {
        const { result } = run(`/games/7?notif=${UUID}`);
        expect(markRead).toHaveBeenCalledWith(UUID);
        expect(result.current).toBe('');
    });
});
