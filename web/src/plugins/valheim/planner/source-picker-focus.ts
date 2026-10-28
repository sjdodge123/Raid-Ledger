/** ROK-1860 AC9 — where focus goes once a source pick has re-rendered the plan tree. */
export const OTHER_WAYS_TESTID = 'valheim-planner-other-ways';

function findTree(label: string): HTMLElement | null {
    for (const el of document.querySelectorAll<HTMLElement>('ul[aria-label]')) {
        if (el.getAttribute('aria-label') === label) return el;
    }
    return null;
}

function isChipFor(el: Element, prefab: string): boolean {
    return el instanceof HTMLElement && el.dataset.testid === OTHER_WAYS_TESTID && el.dataset.prefab === prefab;
}

function findChip(tree: HTMLElement, prefab: string): HTMLElement | null {
    for (const el of tree.querySelectorAll<HTMLElement>(`[data-testid="${OTHER_WAYS_TESTID}"]`)) {
        if (isChipFor(el, prefab)) return el;
    }
    return null;
}

/**
 * 'wait' while focus still sits on that prefab's chip (the plan may yet
 * re-render it) or the tree is not back yet; 'done' once focus is restored
 * or the user has moved it elsewhere.
 */
export function refocusAfterPick(treeLabel: string, prefab: string): 'done' | 'wait' {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return isChipFor(active, prefab) ? 'wait' : 'done';
    const tree = findTree(treeLabel);
    if (tree === null) return 'wait';
    (findChip(tree, prefab) ?? tree).focus();
    return 'done';
}
