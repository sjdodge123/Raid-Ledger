/**
 * ROK-1767: profile switch for auto game roles. On (the default) lets the bot
 * give the member a game's Discord role while they play it; off writes the
 * `discord_game_roles_opt_out` preference and the next sync removes any role
 * the bot gave them.
 */
import type { JSX } from 'react';
import { Switch } from '../../components/ui/switch';

const DESCRIPTION_ID = 'game-roles-opt-out-description';

export function GameRolesOptOutToggle({ enabled, onToggle, isPending }: {
    enabled: boolean; onToggle: (enabled: boolean) => void; isPending: boolean;
}): JSX.Element {
    return (
        <div className="mt-4 p-4 bg-panel rounded-lg border border-edge" data-testid="game-roles-opt-out">
            <div className="flex items-center justify-between gap-4">
                <div>
                    <h3 className="text-sm font-semibold text-foreground">Auto game roles</h3>
                    <p id={DESCRIPTION_ID} className="text-sm text-muted mt-0.5">
                        Let Raid Ledger give you a game&apos;s Discord role when you play it
                    </p>
                </div>
                <Switch label="Auto game roles" checked={enabled} onChange={onToggle}
                    disabled={isPending} aria-describedby={DESCRIPTION_ID} />
            </div>
        </div>
    );
}
