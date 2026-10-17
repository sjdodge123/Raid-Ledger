/**
 * ROK-1785 — "Page editors": who may edit this guild's page. Admins and
 * operators always can; the Guild Master needs an explicit grant until
 * character ownership is verified (api `GM_RANK_IMPLIES_EDIT`). Staff
 * delegate to whole ranks or chosen members (removable chips, design-system
 * §4.3). The prototype put this on the Resources tab; Resources is hidden in
 * S1, so it is a collapsible card on Overview until that tab ships.
 */
import type { JSX } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { GuildEditor, GuildPage } from '@raid-ledger/contract';
import { Button } from '../../../components/ui/button';
import { RoleBadge } from '../../../components/ui/role-badge';
import { ScrollCollapsible } from '../../../components/ui/scroll-collapsible';
import { Card } from '../../../components/hub/hub-bits';
import { AddMemberEditor, AddRankEditor } from './editor-forms';
import { gmIsEditor } from './wow-guild.helpers';
import { useAddGuildEditor, useGuildEditors, useRemoveGuildEditor } from '../../../components/hub/api/use-guild';

/** Rank 0 is not an implicit editor: staff grant the GM explicitly. */
const GM_HINT = 'Add your Guild Master as an editor.';

function AlwaysEditors(): JSX.Element {
    return (
        <div>
            <h3 className="mb-2 text-sm font-semibold text-foreground">Always can edit</h3>
            <ul className="flex flex-col gap-1 text-sm text-secondary">
                <li className="flex items-center gap-2">Raid Ledger admins <RoleBadge role="admin" /></li>
                <li className="flex items-center gap-2">Raid Ledger operators <RoleBadge role="operator" /></li>
            </ul>
        </div>
    );
}

function editorLabel(e: GuildEditor): string {
    if (e.kind === 'rank') return `Rank: ${e.rankName ?? `Rank ${e.rankIndex ?? '?'}`}`;
    return e.memberName ?? 'Unknown member';
}

function EditorChip({ editor, disabled, onRemove }: { editor: GuildEditor; disabled: boolean; onRemove: () => void }): JSX.Element {
    const label = editorLabel(editor);
    return (
        <li data-testid="guild-editor-chip"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-success/30 bg-success/10 pl-3 text-sm font-medium text-success">
            {label}
            <Button variant="ghost" iconOnly aria-label={`Remove ${label}`} onClick={onRemove} disabled={disabled}>
                <XMarkIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
        </li>
    );
}

function DelegatedEditors({ page }: { page: GuildPage }): JSX.Element {
    const guildId = page.guild.id;
    const editors = useGuildEditors(guildId, true);
    const add = useAddGuildEditor(guildId);
    const remove = useRemoveGuildEditor(guildId);
    const list = editors.data?.editors ?? [];
    const pending = add.isPending || remove.isPending;
    const error = editors.error ?? add.error ?? remove.error;
    return (
        <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">Delegated</h3>
            {!gmIsEditor(page, list) && <p className="text-sm text-secondary" data-testid="guild-editors-gm-hint">{GM_HINT}</p>}
            <ul aria-label="Page editors" className="flex flex-wrap gap-2">
                {list.map((e) => <EditorChip key={e.id} editor={e} disabled={pending} onRemove={() => remove.mutate(e.id)} />)}
            </ul>
            {editors.isSuccess && list.length === 0 && <p className="text-sm text-muted">No one yet. Add a rank or a member below — start with your Guild Master.</p>}
            {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error.message}</p>}
            <AddRankEditor page={page} editors={list} pending={pending} onAdd={(i) => add.mutate(i)} />
            <AddMemberEditor page={page} editors={list} pending={pending} onAdd={(i) => add.mutate(i)} />
        </div>
    );
}

/** Rendered only when `viewer.canManageEditors` (the caller gates it). */
export function GuildEditorsCard({ page }: { page: GuildPage }): JSX.Element {
    return (
        <section id="editors" className="scroll-mt-4" data-testid="guild-editors-panel">
            <Card>
                <ScrollCollapsible title="Page editors">
                    <p className="mb-4 text-sm text-secondary">Who can edit this guild&apos;s page.</p>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                        <AlwaysEditors />
                        <DelegatedEditors page={page} />
                    </div>
                </ScrollCollapsible>
            </Card>
        </section>
    );
}
