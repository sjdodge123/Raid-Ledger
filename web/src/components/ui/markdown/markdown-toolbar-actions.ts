/**
 * The toolbar's action table (ROK-1868 spec §3.6) — one row per D14 construct.
 * Shortcuts are TipTap's defaults (Mod = Ctrl / ⌘) plus the custom Mod-K.
 */
import type { ComponentType, SVGProps } from 'react';
import type { Editor } from '@tiptap/core';
import {
    BoldIcon, CodeBracketIcon, ItalicIcon, LinkIcon, ListBulletIcon, NumberedListIcon, StrikethroughIcon,
} from '@heroicons/react/24/outline';

export interface ToolbarAction {
    key: string;
    label: string;
    icon: ComponentType<SVGProps<SVGSVGElement>>;
    /** The key after "Mod+", e.g. `B` or `Shift+S`. */
    shortcut: string;
    isActive: (e: Editor) => boolean;
    /** Runs the command; `link` is handled by the editor (opens the link row). */
    run: ((e: Editor) => void) | 'link';
}

export const TOOLBAR_ACTIONS: readonly ToolbarAction[] = [
    { key: 'bold', label: 'Bold', icon: BoldIcon, shortcut: 'B', isActive: (e) => e.isActive('bold'), run: (e) => { e.chain().focus().toggleBold().run(); } },
    { key: 'italic', label: 'Italic', icon: ItalicIcon, shortcut: 'I', isActive: (e) => e.isActive('italic'), run: (e) => { e.chain().focus().toggleItalic().run(); } },
    { key: 'strike', label: 'Strikethrough', icon: StrikethroughIcon, shortcut: 'Shift+S', isActive: (e) => e.isActive('strike'), run: (e) => { e.chain().focus().toggleStrike().run(); } },
    { key: 'code', label: 'Code', icon: CodeBracketIcon, shortcut: 'E', isActive: (e) => e.isActive('code'), run: (e) => { e.chain().focus().toggleCode().run(); } },
    { key: 'link', label: 'Link', icon: LinkIcon, shortcut: 'K', isActive: (e) => e.isActive('link'), run: 'link' },
    { key: 'bullets', label: 'Bulleted list', icon: ListBulletIcon, shortcut: 'Shift+8', isActive: (e) => e.isActive('bulletList'), run: (e) => { e.chain().focus().toggleBulletList().run(); } },
    { key: 'numbers', label: 'Numbered list', icon: NumberedListIcon, shortcut: 'Shift+7', isActive: (e) => e.isActive('orderedList'), run: (e) => { e.chain().focus().toggleOrderedList().run(); } },
];

/** `aria-keyshortcuts` value: both platforms' chords. */
export function ariaShortcut(shortcut: string): string {
    return `Control+${shortcut} Meta+${shortcut}`;
}

/** `title` text: "Bold (⌘B)" on Apple, "Bold (Ctrl+B)" elsewhere, name only on coarse pointers. */
export function actionTitle(a: ToolbarAction, env: { mac: boolean; coarse: boolean }): string {
    if (env.coarse) return a.label;
    return env.mac ? `${a.label} (⌘${a.shortcut.replace('Shift+', '⇧')})` : `${a.label} (Ctrl+${a.shortcut})`;
}
