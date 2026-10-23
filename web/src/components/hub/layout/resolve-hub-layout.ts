/**
 * ROK-1918 §2.2 — resolve a hub's Overview layout: the widgets this viewer may
 * see (the catalog) + the hub's saved `HubWidgetPrefs` → what renders, in what
 * order. Pure, so the Overview and arrange mode (L5) agree by construction.
 *
 * Rules:
 * 1. Ids in the prefs that are not in the catalog are ignored (uninstalled or
 *    deactivated plugin, renamed widget) — AC3.
 * 2. A widget is on when `defaultOn ? !hidden : added`; hidden wins over added.
 * 3. Saved ids keep their saved relative order. A default-ON widget missing from
 *    `order` (shipped after the hub saved) slots in right after the nearest
 *    widget that precedes it in default order and is placed, else at the top
 *    (Q4: it shows automatically). An ADDED default-off widget missing from
 *    `order` lands at the top (Q3).
 * 4. Audience is re-checked here: prefs can only remove or opt in among widgets
 *    the viewer may already see — adding never bypasses audience (AC4).
 */
import type { GuildPage, HubWidgetId, HubWidgetPrefs } from '@raid-ledger/contract';
import { audienceAllows, type HubWidgetAudience } from '../../../plugins/hub-game-widgets';

/** What the resolver (and the arrange list) needs to know about one widget. */
export interface HubLayoutEntry {
    /** The stable `Cell.key`: `gm-post`, `module:<id>`, `plugin:<slug>:<id>`, `generic:<id>`. */
    id: HubWidgetId;
    title: string;
    description?: string;
    /** The registration's `order` — the slot used when the hub saved nothing. */
    defaultOrder: number;
    /** Columns at ≥1024px, for the arrange list's size chip. */
    span: 1 | 2 | 3;
    audience: HubWidgetAudience;
    defaultOn: boolean;
}

/** One placed widget in arrange order; `on: false` = a default-on widget the hub hid. */
export interface ArrangedEntry<E extends HubLayoutEntry> {
    entry: E;
    on: boolean;
}

export interface ResolvedHubLayout<E extends HubLayoutEntry> {
    /** What the Overview renders, in order. */
    visible: E[];
    /** Placed widgets (on + hidden default-on) in order — arrange mode's list (Q2: hidden stay in place, dimmed). */
    arranged: ArrangedEntry<E>[];
    /** Default-on widgets the hub hid, in arranged order. */
    hidden: E[];
    /** Opt-in widgets not added yet, in default order — the Add picker. */
    available: E[];
}

type Viewer = GuildPage['viewer'];

function byDefaultOrder<E extends HubLayoutEntry>(catalog: readonly E[]): E[] {
    return [...catalog].sort((a, b) => a.defaultOrder - b.defaultOrder);
}

/** Whether a widget is placed (in the arrange list) and whether it renders. */
function placement(e: HubLayoutEntry, prefs: HubWidgetPrefs | null): { placed: boolean; on: boolean } {
    const hidden = prefs?.hidden.includes(e.id) ?? false;
    if (e.defaultOn) return { placed: true, on: !hidden };
    const added = prefs?.added.includes(e.id) ?? false;
    return { placed: added && !hidden, on: added && !hidden };
}

/** Q4: slot each unsaved default-on widget after its nearest placed default-order predecessor. */
function insertUnsaved<E extends HubLayoutEntry>(sorted: readonly E[], placed: E[], saved: ReadonlySet<string>): void {
    sorted.forEach((e, i) => {
        if (saved.has(e.id) || !e.defaultOn) return;
        const anchor = sorted.slice(0, i).reverse().find((p) => placed.includes(p));
        placed.splice(anchor === undefined ? 0 : placed.indexOf(anchor) + 1, 0, e);
    });
}

function placedInOrder<E extends HubLayoutEntry>(sorted: readonly E[], prefs: HubWidgetPrefs | null): E[] {
    const isPlaced = (e: E): boolean => placement(e, prefs).placed;
    const byId = new Map(sorted.map((e) => [e.id, e]));
    const fromSaved = [...new Set(prefs?.order ?? [])].flatMap((id) => {
        const e = byId.get(id);
        return e !== undefined && isPlaced(e) ? [e] : [];
    });
    const saved = new Set(fromSaved.map((e) => e.id));
    const placed = [...fromSaved];
    insertUnsaved(sorted.filter(isPlaced), placed, saved);
    // Q3: an added opt-in widget the saved order does not know yet goes on top.
    const newAdds = sorted.filter((e) => !e.defaultOn && isPlaced(e) && !saved.has(e.id));
    return [...newAdds, ...placed];
}

/**
 * Resolve the Overview layout. `prefs: null` (nothing saved) renders every
 * default-on widget in default order — exactly the pre-ROK-1918 Overview.
 */
export function resolveHubLayout<E extends HubLayoutEntry>(
    catalog: readonly E[],
    prefs: HubWidgetPrefs | null,
    viewer: Viewer,
): ResolvedHubLayout<E> {
    const sorted = byDefaultOrder(catalog.filter((e) => audienceAllows(e.audience, viewer)));
    const arranged = placedInOrder(sorted, prefs).map((entry) => ({ entry, on: placement(entry, prefs).on }));
    return {
        visible: arranged.filter((a) => a.on).map((a) => a.entry),
        arranged,
        hidden: arranged.filter((a) => !a.on).map((a) => a.entry),
        available: sorted.filter((e) => !placement(e, prefs).placed),
    };
}
