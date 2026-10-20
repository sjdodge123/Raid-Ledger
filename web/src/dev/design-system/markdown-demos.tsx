/**
 * Lazy entry for the ROK-1868 markdown demos (spec §3.6): `MarkdownBlock`,
 * `CharCounter` and the `LazyMarkdownEditor` frames. Split out of
 * DesignSystemPage's chunk, which sits at its 20.3 KB gz cap — the parser,
 * renderer and demo copy would otherwise push it over.
 */
import type { JSX } from 'react';
import { MarkdownStates } from './markdown-block-demo';
import { MarkdownEditorStates } from './markdown-editor-demo';

/** Every markdown state frame for the Forms grid. */
export default function MarkdownDemos(): JSX.Element {
    return (
        <>
            <MarkdownStates />
            <MarkdownEditorStates />
        </>
    );
}
