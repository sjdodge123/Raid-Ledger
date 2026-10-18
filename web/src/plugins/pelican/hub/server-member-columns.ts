/** ROK-1831 — the game-server Members columns (cells in `server-member-cells.tsx`). */
import type { HubMemberColumn } from '../../hub-module';
import { CharacterCell, LastSeenCell, OnlineCell, PlayerCell } from './server-member-cells';

export const SERVER_MEMBER_COLUMNS: readonly HubMemberColumn[] = [
    { id: 'player', header: 'Player', cell: PlayerCell },
    { id: 'character', header: 'Character', cell: CharacterCell },
    { id: 'online', header: 'Online now', cell: OnlineCell },
    { id: 'last-seen', header: 'Last seen', cell: LastSeenCell },
];
