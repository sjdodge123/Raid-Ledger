/**
 * ROK-1786 — inline editor for the link groups: group title + rows of
 * label / URL / note. Saves the whole set; the server validates the URLs.
 */
import { useState, type JSX } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import {
    GUILD_LINK_GROUPS_MAX, GUILD_LINK_LABEL_MAX, GUILD_LINK_NOTE_MAX, GUILD_LINKS_PER_GROUP_MAX, GUILD_URL_MAX,
    type GuildLink, type GuildLinkGroup,
} from '@raid-ledger/contract';
import { Button } from '../../ui/button';
import { Field } from '../../ui/field';
import { Input } from '../../ui/input';
import { moveItem } from './guild-content.helpers';
import { EditorFooter, ItemControls } from './list-editor-bits';

const EMPTY_LINK: GuildLink = { label: '', url: '' };

function LinkFields({ link, onChange }: { link: GuildLink; onChange: (l: GuildLink) => void }): JSX.Element {
    return (
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 md:grid-cols-3">
            <Field label="Label"><Input value={link.label} maxLength={GUILD_LINK_LABEL_MAX} onChange={(e) => onChange({ ...link, label: e.target.value })} /></Field>
            <Field label="URL"><Input type="url" inputMode="url" value={link.url} maxLength={GUILD_URL_MAX} placeholder="https://" onChange={(e) => onChange({ ...link, url: e.target.value })} /></Field>
            <Field label="Note"><Input value={link.note ?? ''} maxLength={GUILD_LINK_NOTE_MAX} onChange={(e) => onChange({ ...link, note: e.target.value })} /></Field>
        </div>
    );
}

function GroupFields({ group, onChange }: { group: GuildLinkGroup; onChange: (g: GuildLinkGroup) => void }): JSX.Element {
    const setLinks = (links: GuildLink[]): void => onChange({ ...group, links });
    return (
        <>
            <ul className="flex flex-col gap-2">
                {group.links.map((l, i) => (
                    <li key={i} className="flex items-end gap-2 border-t border-edge-subtle pt-2" data-testid="guild-link-editor-row">
                        <LinkFields link={l} onChange={(n) => setLinks(group.links.map((x, j) => (j === i ? n : x)))} />
                        <ItemControls name={l.label.trim() || `link ${i + 1}`} index={i} count={group.links.length}
                            onMove={(dir) => setLinks(moveItem(group.links, i, dir))} onRemove={() => setLinks(group.links.filter((_, j) => j !== i))} />
                    </li>
                ))}
            </ul>
            <div><Button variant="ghost" size="sm" disabled={group.links.length >= GUILD_LINKS_PER_GROUP_MAX} onClick={() => setLinks([...group.links, EMPTY_LINK])}>
                <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add link
            </Button></div>
        </>
    );
}

/** Drops empty notes; a group needs a title and every link a label + URL. */
function cleanGroups(draft: GuildLinkGroup[]): { groups: GuildLinkGroup[]; valid: boolean } {
    const groups = draft.map((g) => ({
        title: g.title.trim(),
        links: g.links.map((l) => ({ label: l.label.trim(), url: l.url.trim(), ...(l.note?.trim() ? { note: l.note.trim() } : {}) })),
    }));
    const valid = groups.every((g) => g.title && g.links.length > 0 && g.links.every((l) => l.label && l.url));
    return { groups, valid };
}

export function LinksEditor({ initial, saving, failed, onSave, onCancel }: {
    initial: GuildLinkGroup[]; saving: boolean; failed: boolean; onSave: (g: GuildLinkGroup[]) => void; onCancel: () => void;
}): JSX.Element {
    const [draft, setDraft] = useState<GuildLinkGroup[]>(initial);
    const set = (i: number, g: GuildLinkGroup): void => setDraft((d) => d.map((x, j) => (j === i ? g : x)));
    const { groups, valid } = cleanGroups(draft);
    return (
        <div className="flex flex-col gap-3" data-testid="guild-links-editor">
            {draft.map((g, i) => (
                <div key={i} className="flex flex-col gap-2 rounded-lg border border-edge bg-panel p-3">
                    <div className="flex items-end gap-2">
                        <Field label="Group title" className="min-w-0 flex-1"><Input value={g.title} maxLength={GUILD_LINK_LABEL_MAX} onChange={(e) => set(i, { ...g, title: e.target.value })} /></Field>
                        <ItemControls name={g.title.trim() || `group ${i + 1}`} index={i} count={draft.length}
                            onMove={(dir) => setDraft((d) => moveItem(d, i, dir))} onRemove={() => setDraft((d) => d.filter((_, j) => j !== i))} />
                    </div>
                    <GroupFields group={g} onChange={(n) => set(i, n)} />
                </div>
            ))}
            <div><Button variant="secondary" size="sm" disabled={draft.length >= GUILD_LINK_GROUPS_MAX}
                onClick={() => setDraft((d) => [...d, { title: '', links: [EMPTY_LINK] }])}>
                <PlusIcon className="h-4 w-4" aria-hidden="true" /> Add group
            </Button></div>
            <EditorFooter saving={saving} failed={failed} canSave={valid} onCancel={onCancel} testId="guild-links-save" onSave={() => onSave(groups)} />
        </div>
    );
}
