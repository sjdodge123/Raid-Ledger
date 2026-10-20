/**
 * MarkdownEditor (ROK-1868 spec §3.2 / §3.6, D13–D22) — the WYSIWYG composer
 * for hub posts. `value` / `onChange` carry Markdown source in the D14 subset;
 * the counter shows SOURCE length (D20). Frame = `FIELD_FRAME_BASE` with a
 * focus-WITHIN ring; the contenteditable is `role="textbox"` and drops its own
 * outline because the wrapper draws the ring. Default export: this module is
 * the lazy boundary — app code imports `LazyMarkdownEditor`, never this file.
 */
import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { useFieldContext, useFieldControlProps } from '../field-context';
import { CharCounter } from '../char-counter';
import { FIELD_FRAME_BASE, FOCUS_WITHIN_RING } from '../form-classes';
import { buildMarkdownExtensions } from './markdown-extensions';
import { normalizeEditorMarkdown } from './markdown-serialize';
import { flattenPastedLists } from './markdown-paste';
import { MarkdownToolbar } from './markdown-toolbar';
import { MarkdownLinkRow } from './markdown-link-row';

export interface MarkdownEditorProps {
    /** Markdown source (D14 subset). */
    value: string;
    onChange: (markdown: string) => void;
    /** Max SOURCE characters; the counter turns `invalid` above it (no hard stop). */
    maxLength: number;
    id?: string | undefined;
    'aria-labelledby'?: string | undefined;
    'aria-describedby'?: string | undefined;
    invalid?: boolean | undefined;
    disabled?: boolean | undefined;
    placeholder?: string | undefined;
    autoFocus?: boolean | undefined;
    testId?: string | undefined;
}

const CONTENT_CLASS = 'min-h-[7.5rem] px-3 py-2 outline-none text-base lg:text-sm text-foreground whitespace-pre-wrap';

function useA11y(p: MarkdownEditorProps, countId: string): Record<string, string> {
    const field = useFieldContext();
    const a11y = useFieldControlProps({
        id: p.id, invalid: p.invalid || p.value.length > p.maxLength,
        'aria-describedby': [countId, p['aria-describedby'] ?? ''].filter(Boolean).join(' '),
    });
    const attrs: Record<string, string> = { role: 'textbox', 'aria-multiline': 'true', class: CONTENT_CLASS };
    const labelledBy = p['aria-labelledby'] ?? field?.labelId;
    if (a11y.id) attrs['id'] = a11y.id;
    if (labelledBy) attrs['aria-labelledby'] = labelledBy;
    if (a11y['aria-describedby']) attrs['aria-describedby'] = a11y['aria-describedby'];
    if (a11y['aria-invalid']) attrs['aria-invalid'] = 'true';
    if (p.disabled) attrs['aria-disabled'] = 'true';
    return attrs;
}

/** Emits normalised markdown upward and re-syncs when the parent swaps `value`. */
function useMarkdownEditor(p: MarkdownEditorProps, attrs: Record<string, string>, openLink: () => void) {
    const last = useRef(p.value);
    const linkRef = useRef(openLink);
    linkRef.current = openLink;
    const extensions = useMemo(() => buildMarkdownExtensions({
        ...(p.placeholder === undefined ? {} : { placeholder: p.placeholder }),
        onLinkShortcut: () => linkRef.current(),
    }), [p.placeholder]);
    const editor = useEditor({
        extensions, content: p.value, contentType: 'markdown', editable: !p.disabled,
        autofocus: p.autoFocus ? 'end' : false, editorProps: { attributes: attrs, transformPastedHTML: flattenPastedLists },
        onUpdate: ({ editor: e }) => { const md = normalizeEditorMarkdown(e.getMarkdown()); last.current = md; p.onChange(md); },
    }, [extensions]);
    useEffect(() => { editor.setOptions({ editorProps: { attributes: attrs, transformPastedHTML: flattenPastedLists } }); }, [editor, attrs]);
    useEffect(() => { editor.setEditable(!p.disabled); }, [editor, p.disabled]);
    useEffect(() => {
        if (p.value === last.current) return;
        last.current = p.value;
        editor.commands.setContent(p.value, { contentType: 'markdown', emitUpdate: false });
    }, [editor, p.value]);
    return editor;
}

/** The hub-post rich-text editor. Use through `LazyMarkdownEditor`. */
export default function MarkdownEditor(props: MarkdownEditorProps): JSX.Element {
    const countId = `${useId()}-count`;
    const [linkOpen, setLinkOpen] = useState(false);
    const raw = useA11y(props, countId);
    const attrs = useMemo(() => raw, [JSON.stringify(raw)]); // eslint-disable-line react-hooks/exhaustive-deps
    const editor = useMarkdownEditor(props, attrs, () => setLinkOpen(true));
    const over = props.value.length > props.maxLength;
    return (
        <div className="w-full">
            <div data-md-editor="" data-testid={props.testId} aria-invalid={attrs['aria-invalid'] ? true : undefined}
                className={`${FIELD_FRAME_BASE} ${FOCUS_WITHIN_RING} overflow-hidden`}>
                <MarkdownToolbar editor={editor} controls={attrs['id'] ?? ''} disabled={props.disabled} onLink={() => setLinkOpen(true)} />
                {linkOpen && <MarkdownLinkRow editor={editor} onClose={() => setLinkOpen(false)} />}
                <EditorContent editor={editor} />
            </div>
            <CharCounter id={countId} length={props.value.length} max={props.maxLength} invalid={over} testId="md-editor-count" />
        </div>
    );
}
