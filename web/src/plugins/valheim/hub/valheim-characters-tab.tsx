/**
 * ROK-1836 — the Valheim server hub's Characters tab body (D1). Takes the
 * hub's Pelican server id; `charactersHubTab` in `register.ts` adapts it to
 * the ROK-1831 `HubTab` seam once that lands.
 */
import { useLocation } from 'react-router-dom';
import { useValheimCharacters } from '../hooks/use-valheim-characters';
import { ValheimCharacterRow } from './valheim-character-row';

function Quiet({ children, role }: { children: string; role?: 'alert' }) {
    return <div className="py-12 text-center" role={role}><p className="text-sm text-muted">{children}</p></div>;
}

export function ValheimCharactersTab({ serverId }: { serverId: number }) {
    const { pathname, search } = useLocation();
    const query = useValheimCharacters(serverId);
    const rows = query.data ?? [];
    return (
        <section aria-labelledby="valheim-characters-h" aria-busy={query.isPending}>
            <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-2">
                <h2 id="valheim-characters-h" className="text-lg font-semibold text-foreground">
                    Characters {query.isSuccess && <span className="text-sm font-medium text-muted">{rows.length}</span>}
                </h2>
                <span className="text-xs text-dim">Characters seen on this server by the Valheim Link mod</span>
            </div>
            {query.isError && <Quiet role="alert">Couldn't load characters. Try again in a moment.</Quiet>}
            {query.isSuccess && rows.length === 0 && (
                <Quiet>No characters yet. They appear after a player joins with the Valheim Link mod.</Quiet>
            )}
            {rows.length > 0 && (
                <ul className="flex flex-col gap-2">
                    {rows.map((c) => <ValheimCharacterRow key={c.id} character={c} hubPath={`${pathname}${search}#characters`} />)}
                </ul>
            )}
        </section>
    );
}
