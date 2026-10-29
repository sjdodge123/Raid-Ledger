/** ROK-1933 part 4 — pure helpers for the settings sheet's "Re-post welcome message". */
import type { GuildSummary, HubWelcomeResult } from '@raid-ledger/contract';

/** Only a Valheim server hub gets a welcome embed (the API's `isWelcomeHub`). */
export function isWelcomeHub(guild: Pick<GuildSummary, 'kind' | 'gameSlug'>): boolean {
    return guild.kind === 'game_server' && guild.gameSlug === 'valheim';
}

/** "Posted · pinned" / "Updated" — the outcome line under the button. */
export function welcomeResultLine(result: HubWelcomeResult): string {
    const verb = result.result === 'posted' ? 'Posted' : 'Updated';
    return result.pinned ? `${verb} · pinned` : verb;
}
