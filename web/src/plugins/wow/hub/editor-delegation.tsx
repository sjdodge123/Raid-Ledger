/**
 * ROK-1830 S4 — what WoW adds to core's "Page editors" section: the member
 * grant picker and, while any old rank grant is on the list, a read-only line
 * saying rank grants no longer give rights (ROK-1794 "explicit grants only"). Core owns the list, the chips, the mutations and the
 * endpoints; only the shapes a WoW guild can delegate to live here, because
 * core knows nothing about ranks.
 *
 * Replaces the Overview `GuildEditorsCard` widget (ROK-1785), which held the
 * same forms inside a collapsible card of its own.
 */
import type { JSX } from 'react';
import type { HubEditorDelegationCtx } from '../../hub-module';
import { AddMemberEditor } from './editor-forms';
import { gmIsEditor } from './wow-guild.helpers';

/**
 * Rank 0 is not an implicit editor: staff grant the GM explicitly (api
 * `GM_RANK_IMPLIES_EDIT`) — by name, after checking the linked account the
 * picker shows, never because a row holds rank 0 (ROK-1794 review).
 */
const GM_HINT = "Grant the Guild Master by name once you've confirmed the linked account is theirs.";

/** ROK-1794: kept rank grants are inactive — only a grant by name gives edit (and re-import) rights. */
const RANK_NOTE = 'Rank grants no longer give edit rights. Grant each editor by name.';

export function WowEditorDelegation({ page, editors, pending, onAdd }: HubEditorDelegationCtx): JSX.Element {
    return (
        <div className="flex flex-col gap-3" data-testid="wow-editor-delegation">
            {!gmIsEditor(page, editors) && <p className="text-sm text-secondary" data-testid="guild-editors-gm-hint">{GM_HINT}</p>}
            {editors.some((e) => e.kind === 'rank') && <p className="text-sm text-muted" data-testid="guild-editors-rank-note">{RANK_NOTE}</p>}
            <AddMemberEditor page={page} editors={editors} pending={pending} onAdd={onAdd} />
        </div>
    );
}
