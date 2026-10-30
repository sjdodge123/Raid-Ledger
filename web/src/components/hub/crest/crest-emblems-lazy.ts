/**
 * ROK-1814 — lazy access to the preset emblem art. `HubCrest` sits in the
 * always-loaded header (hub nav rows), so its ~9.5 KB gz of path data must not
 * ride in the first page load: the art loads on the first preset crest that
 * mounts, then stays cached for every later one.
 */
import { useEffect, useState } from 'react';
import type { GuildCrestEmblemId } from '@raid-ledger/contract';
import type { CrestEmblemArt } from './crest-emblems';

type EmblemMap = Record<GuildCrestEmblemId, CrestEmblemArt>;

let loaded: EmblemMap | null = null;
let pending: Promise<EmblemMap> | null = null;

/** Load (once) and cache the emblem map; a failed load is retried on the next call. */
export function loadCrestEmblems(): Promise<EmblemMap> {
    if (loaded) return Promise.resolve(loaded);
    pending ??= import('./crest-emblems').then(
        (m) => (loaded = m.CREST_EMBLEMS),
        (err: unknown) => {
            pending = null;
            throw err;
        },
    );
    return pending;
}

/** One emblem's art, or `null` until the art chunk has loaded (or if it failed to). */
export function useCrestEmblemArt(id: GuildCrestEmblemId): CrestEmblemArt | null {
    const [map, setMap] = useState<EmblemMap | null>(loaded);
    useEffect(() => {
        if (map) return;
        let live = true;
        loadCrestEmblems().then((m) => { if (live) setMap(m); }, () => undefined);
        return () => { live = false; };
    }, [map]);
    return map ? map[id] : null;
}
