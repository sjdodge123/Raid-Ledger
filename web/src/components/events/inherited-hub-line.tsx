/**
 * ROK-1893 P3 (Codex P2) — the hub a poll lock-in inherits, shown in core.
 * The plugin-owned guild picker lists only WoW guilds the viewer can edit (and
 * vanishes with the Blizzard plugin off), so a plain hub member would carry an
 * invisible tag. This line names the hub and offers the `guildId: null` opt-out.
 */
import type { JSX } from 'react';
import { Button } from '../ui/button';
import { useGuildPage } from '../hub/api/use-guild';
import { hubCopy } from '../hub/hub-copy';

interface InheritedHubLineProps {
    hubId: number;
    /** Clears the tag (the form's `guildId: null` opt-out). */
    onRemove: () => void;
}

/** "Tagged to <hub name>" with a Remove action. */
export function InheritedHubLine({ hubId, onRemove }: InheritedHubLineProps): JSX.Element {
    const guild = useGuildPage(hubId).data?.guild;
    const noun = hubCopy(guild?.kind ?? 'game_community').noun;
    const name = guild?.name ?? `this ${noun}`;
    return (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-edge-subtle bg-surface px-3 py-2" data-testid="inherited-hub-line">
            <p className="text-sm text-secondary">
                Tagged to <span className="font-medium text-foreground">{name}</span>
                <span className="block text-xs text-muted">Shows this event on the {noun} page</span>
            </p>
            <Button variant="secondary" size="sm" onClick={onRemove} aria-label={`Remove the ${noun} tag`}>Remove</Button>
        </div>
    );
}
