/** ROK-1953 — shared test context for the Steam card specs (the cards read only `page.guild.id`). */
import type { GuildPage } from '@raid-ledger/contract';
import type { HubWidgetCtx } from '../../../plugins/hub-game-widgets';

/** A member's view of community hub 5 (BG3). */
export function steamCtx(): HubWidgetCtx {
    const page = {
        guild: { id: 5, kind: 'game_community', gameSlug: 'baldurs-gate-3' },
        viewer: { role: 'member', canEdit: false, canManageEditors: false },
    } as GuildPage;
    return { page, gameSlug: 'baldurs-gate-3' } as HubWidgetCtx;
}
