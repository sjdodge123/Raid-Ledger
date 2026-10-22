/**
 * A6 probe (ROK-1868 spec): pins the `@tiptap/markdown` 3.31.4 surface the
 * editor builds on — `getMarkdown()`, `contentType: 'markdown'`, escaping of
 * literal markdown typed as text, and the serialised form of each mark.
 * If a TipTap bump changes any of these, this file goes red first.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Paragraph from '@tiptap/extension-paragraph';
import Text from '@tiptap/extension-text';
import HardBreak from '@tiptap/extension-hard-break';
import Bold from '@tiptap/extension-bold';
import Italic from '@tiptap/extension-italic';
import Strike from '@tiptap/extension-strike';
import Code from '@tiptap/extension-code';
import { Markdown } from '@tiptap/markdown';

const EXT = [Document, Paragraph, Text, HardBreak, Bold, Italic, Strike, Code, Markdown];
let editor: Editor | null = null;

function make(content = ''): Editor {
    editor = new Editor({ extensions: EXT, content, contentType: 'markdown' });
    return editor;
}

function typed(text: string): string {
    const e = make();
    e.view.dispatch(e.state.tr.insertText(text, 1));
    return e.getMarkdown();
}

afterEach(() => { editor?.destroy(); editor = null; });

describe('@tiptap/markdown 3.31.4 surface (A6)', () => {
    it('parses markdown content via contentType and serialises with getMarkdown()', () => {
        expect(make('**a** *b* ~~c~~ `d`').getMarkdown()).toBe('**a** *b* ~~c~~ `d`');
    });

    it('setContent accepts { contentType: "markdown" }', () => {
        const e = make();
        e.commands.setContent('**x**', { contentType: 'markdown' });
        expect(e.getHTML()).toBe('<p><strong>x</strong></p>');
    });

    it('a typed "# hi" is NOT escaped (block syntax at line start stays literal)', () => {
        expect(typed('# hi')).toBe('# hi');
    });
    it('a typed "<b>" serialises as HTML entities, not backslash escapes', () => {
        expect(typed('<b>x</b>')).toBe('&lt;b&gt;x&lt;/b&gt;');
    });
    it('& and entity text', () => { expect(typed('a & b &lt;')).toBe('a &amp; b &amp;lt;'); });
    it('code mark keeps <', () => {
        const e = make(); e.chain().insertContent('x').selectAll().toggleCode().run();
        e.view.dispatch(e.state.tr.insertText('<div>', 2));
        expect(e.getMarkdown()).toBe('`x<div>`');
    });
    it('an unregistered block token (heading) throws inside setContent -> empty doc', () => {
        expect(make('# hi').getMarkdown()).toBe('');
    });
    it('parse \\< escape', () => { expect(make('\\<b> &lt;i&gt;').getHTML()).toBe('<p>&lt;b&gt; &lt;i&gt;</p>'); });
    it('single newline', () => { expect(make('a\nb').getMarkdown()).toBe('a\nb'); });
    it('single newline breaks:true', () => {
        editor = new Editor({ extensions: [Document, Paragraph, Text, HardBreak, Markdown.configure({ markedOptions: { breaks: true } })], content: 'a\nb', contentType: 'markdown' });
        expect(editor.getMarkdown()).toBe('a  \nb');
    });
    it('three paragraphs + blank', () => { expect(make('a\n\n\n\nb').getMarkdown()).toBe('a\n\n\n\nb'); });
    it('a typed "**x**" is escaped', () => { expect(typed('**x**')).toBe('\\*\\*x\\*\\*'); });

    it('hard break serialises', () => {
        const e = make();
        e.chain().insertContent('a').setHardBreak().insertContent('b').run();
        expect(e.getMarkdown()).toBe('a  \nb');
    });

    it('paragraphs are separated by one blank line', () => {
        expect(make('a\n\nb').getMarkdown()).toBe('a\n\nb');
    });
});
