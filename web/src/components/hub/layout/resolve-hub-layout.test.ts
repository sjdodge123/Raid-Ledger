/** ROK-1918 §2.2 — the pure Overview layout resolver. */
import { describe, it, expect } from 'vitest';
import type { GuildPage, HubWidgetPrefs } from '@raid-ledger/contract';
import { resolveHubLayout, type HubLayoutEntry } from './resolve-hub-layout';

function entry(id: string, defaultOrder: number, over: Partial<HubLayoutEntry> = {}): HubLayoutEntry {
    return { id, title: id, defaultOrder, span: 1, audience: 'everyone', defaultOn: true, ...over };
}

function prefs(over: Partial<HubWidgetPrefs> = {}): HubWidgetPrefs {
    return { order: [], hidden: [], added: [], config: {}, ...over };
}

const member: GuildPage['viewer'] = { role: 'member', canEdit: false, canManageEditors: false };
const visitor: GuildPage['viewer'] = { role: 'visitor', canEdit: false, canManageEditors: false };
const editor: GuildPage['viewer'] = { role: 'officer', canEdit: true, canManageEditors: false };

const CORE = [entry('gm-post', 10), entry('discord', 20), entry('schedule', 30), entry('events', 40, { span: 2 }), entry('attendance', 70)];

const ids = (es: readonly HubLayoutEntry[]): string[] => es.map((e) => e.id);

describe('resolveHubLayout — nothing saved', () => {
    it('renders every default-on widget in default order when prefs are null', () => {
        const shuffled = [CORE[4], CORE[0], CORE[3], CORE[1], CORE[2]].flatMap((e) => (e ? [e] : []));
        const r = resolveHubLayout(shuffled, null, member);
        expect(ids(r.visible)).toEqual(['gm-post', 'discord', 'schedule', 'events', 'attendance']);
        expect(r.hidden).toEqual([]);
        expect(r.arranged.every((a) => a.on)).toBe(true);
    });

    it('keeps catalog order for equal default orders (stable sort, same as the old Overview)', () => {
        const r = resolveHubLayout([entry('a', 50), entry('b', 50), entry('c', 50)], null, member);
        expect(ids(r.visible)).toEqual(['a', 'b', 'c']);
    });

    it('leaves default-off widgets out of the Overview and offers them in the Add picker', () => {
        const r = resolveHubLayout([...CORE, entry('generic:text', 5, { defaultOn: false })], null, member);
        expect(ids(r.visible)).not.toContain('generic:text');
        expect(ids(r.available)).toEqual(['generic:text']);
    });
});

describe('resolveHubLayout — saved order', () => {
    it('applies the saved relative order', () => {
        const r = resolveHubLayout(CORE, prefs({ order: ['attendance', 'events', 'schedule', 'discord', 'gm-post'] }), member);
        expect(ids(r.visible)).toEqual(['attendance', 'events', 'schedule', 'discord', 'gm-post']);
    });

    it('drops ids the catalog no longer has (uninstalled plugin) — AC3', () => {
        const p = prefs({ order: ['plugin:gone:x', 'discord', 'gm-post'], hidden: ['plugin:gone:y'], added: ['plugin:gone:z'] });
        const r = resolveHubLayout([entry('gm-post', 10), entry('discord', 20)], p, member);
        expect(ids(r.visible)).toEqual(['discord', 'gm-post']);
        expect(ids(r.arranged.map((a) => a.entry))).toEqual(['discord', 'gm-post']);
        expect(r.available).toEqual([]);
    });

    it('ignores duplicated ids in a saved order', () => {
        const r = resolveHubLayout(CORE.slice(0, 2), prefs({ order: ['discord', 'discord', 'gm-post'] }), member);
        expect(ids(r.visible)).toEqual(['discord', 'gm-post']);
    });
});

describe('resolveHubLayout — hide and add', () => {
    it('hides a default-on widget but keeps it in place in the arrange list (Q2)', () => {
        const r = resolveHubLayout(CORE, prefs({ order: ['gm-post', 'discord', 'schedule', 'events', 'attendance'], hidden: ['discord'] }), member);
        expect(ids(r.visible)).toEqual(['gm-post', 'schedule', 'events', 'attendance']);
        expect(ids(r.hidden)).toEqual(['discord']);
        expect(r.arranged.map((a) => `${a.entry.id}:${a.on ? 'on' : 'off'}`)).toEqual(['gm-post:on', 'discord:off', 'schedule:on', 'events:on', 'attendance:on']);
    });

    it('shows an added default-off widget at its saved position', () => {
        const text = entry('generic:text', 99, { defaultOn: false });
        const r = resolveHubLayout([...CORE, text], prefs({ order: ['gm-post', 'generic:text', 'discord'], added: ['generic:text'] }), member);
        expect(ids(r.visible).slice(0, 3)).toEqual(['gm-post', 'generic:text', 'discord']);
        expect(r.available).toEqual([]);
    });

    it('puts an added widget missing from the saved order at the top (Q3)', () => {
        const text = entry('generic:text', 99, { defaultOn: false });
        const r = resolveHubLayout([...CORE, text], prefs({ order: ['gm-post', 'discord'], added: ['generic:text'] }), member);
        expect(r.visible[0]?.id).toBe('generic:text');
    });

    it('lets hidden win when an id is both hidden and added', () => {
        const text = entry('generic:text', 5, { defaultOn: false });
        const r = resolveHubLayout([text, ...CORE], prefs({ added: ['generic:text'], hidden: ['generic:text', 'gm-post'] }), member);
        expect(ids(r.visible)).not.toContain('generic:text');
        expect(ids(r.visible)).not.toContain('gm-post');
        expect(ids(r.available)).toEqual(['generic:text']);
    });

    it('ignores `hidden` for an opt-in widget that was never added', () => {
        const r = resolveHubLayout([entry('generic:links', 5, { defaultOn: false })], prefs({ hidden: ['generic:links'] }), member);
        expect(r.hidden).toEqual([]);
        expect(ids(r.available)).toEqual(['generic:links']);
    });
});

describe('resolveHubLayout — a plugin ships a default-on widget after the hub saved (Q4)', () => {
    const saved = prefs({ order: ['attendance', 'gm-post', 'discord', 'schedule', 'events'] });

    it('slots it right after its nearest placed default-order predecessor', () => {
        const r = resolveHubLayout([...CORE, entry('plugin:wow:classes', 45)], saved, member);
        expect(ids(r.visible)).toEqual(['attendance', 'gm-post', 'discord', 'schedule', 'events', 'plugin:wow:classes']);
    });

    it('anchors past a hidden predecessor (hidden widgets are still placed)', () => {
        const r = resolveHubLayout([...CORE, entry('plugin:wow:classes', 25)], prefs({ ...saved, hidden: ['discord'] }), member);
        expect(ids(r.arranged.map((a) => a.entry))).toEqual(['attendance', 'gm-post', 'discord', 'plugin:wow:classes', 'schedule', 'events']);
        expect(ids(r.visible)).toEqual(['attendance', 'gm-post', 'plugin:wow:classes', 'schedule', 'events']);
    });

    it('goes to the top when nothing precedes it in default order', () => {
        const r = resolveHubLayout([...CORE, entry('plugin:wow:banner', 1)], saved, member);
        expect(r.visible[0]?.id).toBe('plugin:wow:banner');
    });

    it('chains two new widgets in their default order', () => {
        const r = resolveHubLayout([...CORE, entry('module:b', 22), entry('module:a', 21)], saved, member);
        expect(ids(r.visible)).toEqual(['attendance', 'gm-post', 'discord', 'module:a', 'module:b', 'schedule', 'events']);
    });

    it('does not auto-show a new default-OFF widget — it waits in the Add picker', () => {
        const r = resolveHubLayout([...CORE, entry('plugin:wow:opt', 45, { defaultOn: false })], saved, member);
        expect(ids(r.visible)).not.toContain('plugin:wow:opt');
        expect(ids(r.available)).toEqual(['plugin:wow:opt']);
    });
});

describe('resolveHubLayout — audience (AC4)', () => {
    const membersOnly = entry('plugin:wow:roster', 50, { audience: 'members' });
    const editorsOnly = entry('plugin:wow:todo', 60, { audience: 'editors', defaultOn: false });

    it('never shows an added members-only widget to a visitor', () => {
        const r = resolveHubLayout([...CORE, membersOnly, editorsOnly], prefs({ order: ['plugin:wow:roster', 'plugin:wow:todo'], added: ['plugin:wow:todo'] }), visitor);
        expect(ids(r.visible)).not.toContain('plugin:wow:roster');
        expect(ids(r.visible)).not.toContain('plugin:wow:todo');
        expect(ids(r.available)).not.toContain('plugin:wow:todo');
    });

    it('shows members-only to a member and an added editors-only widget to an editor', () => {
        const p = prefs({ order: ['plugin:wow:todo', 'plugin:wow:roster'], added: ['plugin:wow:todo'] });
        expect(ids(resolveHubLayout([membersOnly, editorsOnly], p, member).visible)).toEqual(['plugin:wow:roster']);
        expect(ids(resolveHubLayout([membersOnly, editorsOnly], p, editor).visible)).toEqual(['plugin:wow:todo', 'plugin:wow:roster']);
    });
});
