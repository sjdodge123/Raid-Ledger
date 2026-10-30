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

/** The emblem art for one preset crest, or why there is none yet. */
export type CrestEmblemArtState =
    | { status: 'loading'; art: null }
    | { status: 'ready'; art: CrestEmblemArt }
    | { status: 'failed'; art: null };

/**
 * One emblem's art. `failed` when the art chunk would not load (the caller
 * shows its fallback); the failure is per mount, so the next mount retries.
 */
export function useCrestEmblemArt(id: GuildCrestEmblemId): CrestEmblemArtState {
    const [map, setMap] = useState<EmblemMap | null>(loaded);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (map) return;
        let live = true;
        loadCrestEmblems().then((m) => { if (live) setMap(m); }, () => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [map]);
    if (map) return { status: 'ready', art: map[id] };
    return failed ? { status: 'failed', art: null } : { status: 'loading', art: null };
}
