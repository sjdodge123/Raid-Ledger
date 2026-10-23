/**
 * MD_CLASSES — the one class map for rendered Markdown (ROK-1868 spec D22).
 *
 * Used by BOTH `MarkdownBlock` (read side) and the TipTap extensions'
 * `HTMLAttributes` (the editor), so what an author sees while typing is what
 * members see, in every theme. Tokens only: `code` and `a` are the classes
 * `MarkdownText` already shipped (the link green is a design-system §2.2 raw
 * accent with a light-scheme remap).
 */
export const MD_CLASSES = {
    p: 'text-foreground',
    ul: 'list-disc pl-5',
    ol: 'list-decimal pl-5',
    li: 'my-0.5',
    strong: 'font-semibold',
    em: 'italic',
    s: 'line-through',
    code: 'px-1 rounded bg-surface/60 text-xs',
    a: 'text-emerald-400 hover:underline',
    // ROK-1898: card-sized headings — the post body is small text inside a card, so `#` is a
    // section title, not a page title. Tokens only (text-foreground / text-muted).
    h1: 'text-lg font-semibold text-foreground',
    h2: 'text-base font-semibold text-foreground',
    h3: 'text-sm font-semibold uppercase tracking-wide text-muted',
} as const;

/**
 * The element each post heading level renders as (ROK-1898), in `MarkdownBlock` AND the editor.
 * A post body sits inside a card on a page that already owns its `h1` (page title) and `h2`
 * (section / card headings, e.g. the hub Overview's sr-only "Latest post"), so the body's
 * `#` / `##` / `###` start below them at `h3` — the outline stays valid and a post can never
 * add a second page-level `h1`. The visual size comes from `MD_CLASSES.h1–h3`, not the tag.
 */
export const MD_HEADING_TAG = { 1: 'h3', 2: 'h4', 3: 'h5' } as const;

/** A key of {@link MD_CLASSES}. */
export type MarkdownElement = keyof typeof MD_CLASSES;
