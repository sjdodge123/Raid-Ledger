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
} as const;

/** A key of {@link MD_CLASSES}. */
export type MarkdownElement = keyof typeof MD_CLASSES;
