/**
 * Route-level error boundary (ROK-2342 S2). Wraps the routed pages inside the app
 * shell, so a render crash in one page keeps the header and nav and offers Back /
 * Reload instead of replacing the whole app with the root `ErrorFallback`. It
 * resets when the path changes, so navigating away recovers without a reload.
 * React 19's `onCaughtError` (app-entry.tsx) already reports the error to Sentry.
 */
import { Component, type JSX, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { isChunkLoadError } from '../../lib/chunk-error';
import { ErrorDetails } from './error-details';

interface BoundaryProps { resetKey: string; children: ReactNode }
interface BoundaryState { error: unknown; hasError: boolean }

class RouteBoundary extends Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { error: null, hasError: false };

    static getDerivedStateFromError(error: unknown): BoundaryState {
        return { error, hasError: true };
    }

    componentDidUpdate(prev: BoundaryProps): void {
        if (this.state.hasError && prev.resetKey !== this.props.resetKey) this.setState({ error: null, hasError: false });
    }

    render(): ReactNode {
        return this.state.hasError ? <RouteErrorFallback error={this.state.error} /> : this.props.children;
    }
}

/** True when there is an earlier entry inside this app to go back to. */
function hasInAppHistory(): boolean {
    const state: unknown = window.history.state;
    const idx: unknown = typeof state === 'object' && state !== null && 'idx' in state ? state.idx : undefined;
    return typeof idx === 'number' && idx > 0;
}

/** The in-shell fallback: friendly copy, Back + Reload, the raw message in a `<details>`. */
export function RouteErrorFallback({ error }: { error: unknown }): JSX.Element {
    const navigate = useNavigate();
    const isChunk = isChunkLoadError(error);
    const goBack = (): void => {
        // react-router stamps its own history index on `history.state.idx`; `history.length`
        // also counts pages from before the app loaded, so Back could leave the site.
        if (hasInAppHistory()) void navigate(-1);
        else void navigate('/');
    };
    return (
        <div role="alert" data-testid="route-error" className="mx-auto max-w-xl px-4 py-16 text-center">
            <h1 className="text-xl font-semibold text-foreground">{isChunk ? 'New version available' : 'This page hit a problem'}</h1>
            <p className="mt-2 text-sm text-muted">
                {isChunk ? 'The app has been updated. Reload to get the latest version.' : 'Something went wrong showing this page. Go back, or reload to try again.'}
            </p>
            <div className="mt-6 flex justify-center gap-3">
                <Button variant="secondary" onClick={goBack}>Back</Button>
                <Button variant="primary" onClick={() => window.location.reload()}>Reload</Button>
            </div>
            {!isChunk && <ErrorDetails error={error} />}
        </div>
    );
}

/** Keyed on the path: a new route clears a caught crash. */
export function RouteErrorBoundary({ children }: { children: ReactNode }): JSX.Element {
    const { pathname } = useLocation();
    return <RouteBoundary resetKey={pathname}>{children}</RouteBoundary>;
}
