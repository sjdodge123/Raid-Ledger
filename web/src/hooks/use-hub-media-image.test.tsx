/**
 * Tech-debt L3887 — `useHubMediaImageUrl` must fall back (null) when
 * `URL.createObjectURL` throws (Node 24 + jsdom: Node's implementation
 * rejects jsdom's Blob), instead of crashing the consuming component.
 */
import { Component, type ErrorInfo, type JSX, type ReactNode } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render-helpers';
import { useHubMediaImageUrl } from './use-hub-media-image';

vi.mock('../lib/api/fetch-api', () => ({
    fetchWithAuth: vi.fn(async () => ({ ok: true, status: 200, blob: async () => new Blob(['img']) })),
}));

/** Records a crash as visible text so the assertion can name it. */
class CrashCatcher extends Component<{ children: ReactNode }, { error: string | null }> {
    state: { error: string | null } = { error: null };
    static getDerivedStateFromError(err: unknown): { error: string } {
        return { error: err instanceof Error ? err.message : String(err) };
    }
    componentDidCatch(_err: unknown, _info: ErrorInfo): void { /* recorded in state */ }
    render(): ReactNode {
        return this.state.error === null ? this.props.children : <p>crashed: {this.state.error}</p>;
    }
}

function Probe(): JSX.Element {
    const url = useHubMediaImageUrl('/hub/media/1/thumb');
    return <span data-testid="hub-media-url">{url ?? 'fallback'}</span>;
}

describe('useHubMediaImageUrl', () => {
    const original = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const create = vi.fn((): string => { throw new TypeError('blob rejected'); });
    let consoleError: { mockRestore: () => void } | undefined;
    beforeEach(() => {
        create.mockClear();
        Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: create });
        // React logs a caught render/effect error; keep the run quiet either way.
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        if (original) Object.defineProperty(URL, 'createObjectURL', original);
        else Reflect.deleteProperty(URL, 'createObjectURL');
        consoleError?.mockRestore();
    });

    it('returns null (caller fallback) instead of crashing when createObjectURL throws', async () => {
        renderWithProviders(<CrashCatcher><Probe /></CrashCatcher>);
        await waitFor(() => expect(create).toHaveBeenCalled());
        expect(screen.queryByText(/^crashed:/)).toBeNull();
        expect(screen.getByTestId('hub-media-url')).toHaveTextContent('fallback');
    });
});
