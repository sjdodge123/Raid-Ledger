/**
 * LazyMarkdownEditor (ROK-1868 spec D18/D21) — the ONLY import path app code
 * uses for the editor. The TipTap chunk (`markdown-editor-<hash>.js`) is
 * fetched on first render; while pending a frame-shaped `aria-busy`
 * placeholder holds the slot, and if the chunk fails to load (offline, stale
 * deploy) a plain `Textarea` with the same value/onChange takes over so
 * posting is never blocked — the user types markdown by hand.
 */
import { Component, Suspense, lazy, type JSX, type ReactNode } from 'react';
import { Textarea } from '../textarea';
import type { MarkdownEditorProps } from './markdown-editor';

export type { MarkdownEditorProps } from './markdown-editor';

const MarkdownEditor = lazy(() => import('./markdown-editor'));

class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
    override state = { failed: false };
    static getDerivedStateFromError(): { failed: boolean } { return { failed: true }; }
    override render(): ReactNode { return this.state.failed ? this.props.fallback : this.props.children; }
}

function LoadingFrame(): JSX.Element {
    return (
        <div aria-busy="true" data-testid="md-editor-loading"
            className="w-full min-h-[10rem] bg-panel border border-edge rounded-lg animate-pulse">
            <span className="sr-only">Loading editor</span>
        </div>
    );
}

/** The plain-textarea fallback (D21): same value, onChange and counter. */
function PlainFallback(p: MarkdownEditorProps): JSX.Element {
    return (
        <Textarea value={p.value} onChange={(e) => p.onChange(e.target.value)} maxLength={p.maxLength} showCount rows={6}
            {...(p.id === undefined ? {} : { id: p.id })}
            {...(p['aria-describedby'] === undefined ? {} : { 'aria-describedby': p['aria-describedby'] })}
            {...(p['aria-labelledby'] === undefined ? {} : { 'aria-labelledby': p['aria-labelledby'] })}
            {...(p.invalid === undefined ? {} : { invalid: p.invalid })}
            {...(p.disabled === undefined ? {} : { disabled: p.disabled })}
            {...(p.placeholder === undefined ? {} : { placeholder: p.placeholder })}
            {...(p.autoFocus === undefined ? {} : { autoFocus: p.autoFocus })}
            {...(p.testId === undefined ? {} : { 'data-testid': p.testId })} />
    );
}

/** Lazy-loaded {@link MarkdownEditor} with a loading frame and a Textarea fallback. */
export function LazyMarkdownEditor(props: MarkdownEditorProps): JSX.Element {
    return (
        <EditorBoundary fallback={<PlainFallback {...props} />}>
            <Suspense fallback={<LoadingFrame />}>
                <MarkdownEditor {...props} />
            </Suspense>
        </EditorBoundary>
    );
}
