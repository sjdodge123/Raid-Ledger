/**
 * ROK-1918 §4.28 demo — the real `ArrangeRow`, `useRowDrag` and draft helpers
 * over sample rows, with local state instead of the save mutation. Drag at
 * ≥1024px with a mouse; the arrows everywhere. Nothing is saved.
 */
import { useState, type JSX } from 'react';
import { useMediaQuery } from '../../hooks/use-media-query';
import type { HubLayoutEntry } from '../../components/hub/layout/resolve-hub-layout';
import type { DraftRow } from '../../components/hub/arrange/arrange-draft';
// Through the editor loader, not the arrange files: a direct import splits a shared chunk into hub-page's preload list.
import { ArrangeRow, DRAG_MQ, moveAnnouncement, moveRow, moveTo, toggleRow, useRowDrag } from '../../components/hub/overview-editor-tools';

type Row = DraftRow<HubLayoutEntry>;

const SAMPLE: { e: HubLayoutEntry; owner: string; on: boolean }[] = [
    { e: { id: 'gm-post', title: 'Latest post', defaultOrder: 10, span: 1, audience: 'everyone', defaultOn: true }, owner: 'Core', on: true },
    { e: { id: 'discord', title: 'Discord channel', defaultOrder: 20, span: 1, audience: 'everyone', defaultOn: true }, owner: 'Core', on: false },
    { e: { id: 'events', title: 'Upcoming events', defaultOrder: 40, span: 2, audience: 'everyone', defaultOn: true }, owner: 'Core', on: true },
    { e: { id: 'plugin:valheim:bosses', title: 'Boss progress', description: 'Which bosses the server has beaten.', defaultOrder: 50, span: 1, audience: 'members', defaultOn: true }, owner: 'Valheim', on: true },
];

const OWNERS = new Map(SAMPLE.map((s) => [s.e.id, s.owner]));

export default function ArrangeListDemo(): JSX.Element {
    const [rows, setRows] = useState<readonly Row[]>(() => SAMPLE.map((s) => ({ entry: s.e, on: s.on })));
    const [live, setLive] = useState('');
    const canDrag = useMediaQuery(DRAG_MQ);
    const apply = (next: readonly Row[], to: number): void => {
        const moved = next[to];
        if (next === rows || moved === undefined) return;
        setRows(next);
        setLive(moveAnnouncement(moved.entry.title, to + 1, next.length));
    };
    const bindDrag = useRowDrag((from, to) => apply(moveTo(rows, from, to), to));
    return (
        <div className="max-w-xl">
            <ol className="flex flex-col gap-2" aria-label="Sample widgets, in order">
                {rows.map((row, i) => <ArrangeRow key={row.entry.id} row={row} index={i} count={rows.length} owner={OWNERS.get(row.entry.id) ?? 'Core'}
                    onMove={(index, dir) => apply(moveRow(rows, index, dir), index + dir)} onToggle={(id) => setRows((cur) => toggleRow(cur, id))}
                    {...(canDrag ? { drag: bindDrag(i) } : {})} />)}
            </ol>
            <p className="mt-2 text-xs text-muted" aria-live="polite" data-testid="ds-arrange-live">{live || 'Move a row to hear the announcement.'}</p>
        </div>
    );
}
