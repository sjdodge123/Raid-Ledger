/**
 * Paste normalisation the schema alone cannot do (ROK-1868 spec §3.6, D14).
 *
 * The ProseMirror schema already drops anything outside the subset (headings
 * become paragraphs, images/tables/underline vanish), but a nested list would
 * become a SECOND list after the first item. Lists are flat by rule, so nested
 * `ul`/`ol` items are hoisted to siblings of their parent item before parsing.
 */

/**
 * Flatten nested lists in pasted HTML (deepest first).
 * @param html - the clipboard's `text/html`
 * @returns the same HTML with every nested list item hoisted one level up
 */
export function flattenPastedLists(html: string): string {
    if (!/<(ul|ol)\b/i.test(html)) return html;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const nested = Array.from(doc.body.querySelectorAll('li > ul, li > ol')).reverse();
    for (const list of nested) {
        const item = list.parentElement;
        if (!item) continue;
        item.after(...Array.from(list.children));
        list.remove();
    }
    return doc.body.innerHTML;
}
