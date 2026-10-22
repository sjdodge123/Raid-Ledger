/**
 * Lazy tail of the Forms grid: ROK-1655's pickers, ROK-1653's recipes and the
 * ROK-1868 markdown demos (spec §3.6: `MarkdownBlock`, `CharCounter`, the
 * `LazyMarkdownEditor` frame). Split out of DesignSystemPage's chunk, which
 * sits at its 20.3 KB gz cap — the markdown demos alone pushed it over.
 *
 * Keep this chunk's static imports free of any path to `app-entry`: Vite
 * writes every chunk this one statically reaches into DesignSystemPage's
 * `__vite__mapDeps` preload list, and an `app-entry` edge adds ~80 paths
 * (~1.3 KB gz). That is why the editor is passed in by `forms-section.tsx`
 * (`lazy-markdown-editor` reaches `app-entry` through `Textarea`).
 */
import type { JSX } from 'react';
import type { LazyMarkdownEditor } from '../../components/ui/markdown/lazy-markdown-editor';
import { PickerStates } from './forms-pickers-demo';
import { RecipeStates } from './forms-recipes-demo';
import { MarkdownStates } from './markdown-block-demo';
import { MarkdownEditorStates } from './markdown-editor-demo';

/** The pickers, recipes and markdown state frames, in Forms-grid order. */
export default function FormsLazyDemos({ Editor }: { Editor: typeof LazyMarkdownEditor }): JSX.Element {
    return (
        <>
            <PickerStates />
            <RecipeStates />
            <MarkdownStates />
            <MarkdownEditorStates Editor={Editor} />
        </>
    );
}
