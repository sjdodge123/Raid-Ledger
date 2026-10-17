/**
 * ROK-1830 S4 — what WoW adds to core's "Page editors" section: the two grant
 * pickers (a whole rank, or one chosen member) and a read-only line explaining
 * what a rank grant does. Core owns the list, the chips, the mutations and the
 * endpoints; only the shapes a WoW guild can delegate to live here, because
 * core knows nothing about ranks.
 *
 * Replaces the Overview `GuildEditorsCard` widget (ROK-1785), which held the
 * same forms inside a collapsible card of its own.
 */
import type { JSX } from 'react';
import type { HubEditorDelegationCtx } from '../../hub-module';
import { AddMemberEditor, AddRankEditor } from './editor-forms';
import { gmIsEditor } from './wow-guild.helpers';

/** Rank 0 is not an implicit editor: staff grant the GM explicitly (api `GM_RANK_IMPLIES_EDIT`). */
const GM_HINT = 'Add your Guild Master as an editor.';

/** The rank→editor mapping is automatic and WoW-owned: core shows it, it does not manage it. */
const RANK_NOTE = 'A rank grant follows the roster: anyone in that rank can edit, including members who join it later.';

export function WowEditorDelegation({ page, editors, pending, onAdd }: HubEditorDelegationCtx): JSX.Element {
    return (
        <div className="flex flex-col gap-3" data-testid="wow-editor-delegation">
            {!gmIsEditor(page, editors) && <p className="text-sm text-secondary" data-testid="guild-editors-gm-hint">{GM_HINT}</p>}
            <p className="text-sm text-muted" data-testid="guild-editors-rank-note">{RANK_NOTE}</p>
            <AddRankEditor page={page} editors={editors} pending={pending} onAdd={onAdd} />
            <AddMemberEditor page={page} editors={editors} pending={pending} onAdd={onAdd} />
        </div>
    );
}
