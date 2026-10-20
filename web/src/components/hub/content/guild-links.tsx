/**
 * ROK-1786 — "Links & resources" (prototype `proposed/LinksResources.tsx`):
 * titled groups of external links. Editors edit the whole set inline.
 */
import { lazy, Suspense, useState, type JSX } from 'react';
import { ArrowTopRightOnSquareIcon, PencilSquareIcon } from '@heroicons/react/24/outline';
import type { GuildLinkGroup } from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { WidgetCard } from '../hub-bits';
import { useUpdateGuildProfile } from '../api/use-guild-content';

/** Editors only, opened on demand — its own chunk, out of the hub page bundle. */
const LinksEditor = lazy(() => import('./guild-links-editor').then((m) => ({ default: m.LinksEditor })));
const EDITOR_FALLBACK = <div className="h-24 animate-pulse rounded-lg bg-panel" aria-busy="true" />;

function LinkGroupView({ group }: { group: GuildLinkGroup }): JSX.Element {
    return (
        <div className="flex flex-col gap-1" data-testid="guild-link-group">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</h4>
            <ul className="flex flex-col">
                {group.links.map((l) => (
                    <li key={l.url}>
                        <a href={l.url} target="_blank" rel="noopener noreferrer"
                            className="flex min-h-[44px] flex-col justify-center rounded-lg px-2 py-1 transition-colors hover:bg-overlay">
                            <span className="inline-flex items-center gap-1 break-words text-sm font-medium text-success">
                                {l.label}<ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            </span>
                            {l.note && <span className="break-words text-xs text-muted">{l.note}</span>}
                        </a>
                    </li>
                ))}
            </ul>
        </div>
    );
}

export function GuildLinks({ guildId, links, canEdit }: { guildId: number; links: GuildLinkGroup[]; canEdit: boolean }): JSX.Element {
    const [editing, setEditing] = useState(false);
    const save = useUpdateGuildProfile(guildId);
    const action = canEdit && !editing ? (
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)} data-testid="guild-links-edit">
            <PencilSquareIcon className="h-4 w-4" aria-hidden="true" /> Edit links
        </Button>
    ) : undefined;
    let body: JSX.Element;
    if (editing && canEdit) {
        body = <Suspense fallback={EDITOR_FALLBACK}><LinksEditor initial={links} saving={save.isPending} failed={!!save.error} onCancel={() => setEditing(false)}
            onSave={(next) => save.mutate({ links: next }, { onSuccess: () => setEditing(false) })} /></Suspense>;
    } else if (links.length === 0) {
        body = <p className="text-sm text-muted">{canEdit ? 'No links yet. Add guides, logs or a Discord invite.' : 'No links shared yet.'}</p>;
    } else {
        body = <div className="flex flex-col gap-3">{links.map((g, i) => <LinkGroupView key={`${i}-${g.title}`} group={g} />)}</div>;
    }
    return <WidgetCard id="guild-links" title="Links & resources" action={action}>{body}</WidgetCard>;
}
