/** ROK-1836 — the character page's URL helpers (pure, so component files stay fast-refresh clean). */

export function valheimCharacterHref(id: number): string {
    return `/valheim/characters/${id}`;
}

/** A positive integer route id, else null (renders the not-found state, no request). */
export function parseCharacterId(raw: string | undefined): number | null {
    if (raw === undefined || !/^[1-9]\d{0,9}$/.test(raw)) return null;
    return Number(raw);
}

/** Only an in-app hub path from router state is trusted for the crumb. */
export function hubPathFrom(state: unknown): string | null {
    if (typeof state !== 'object' || state === null || !('hubPath' in state)) return null;
    const p = state.hubPath;
    return typeof p === 'string' && p.startsWith('/guilds/') ? p : null;
}
