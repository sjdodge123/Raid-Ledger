/** ROK-2352 §3.6 — `?hub=<id>` on the LFG page. */
import { useSearchParams } from 'react-router-dom';

/** `?hub=<id>` as a positive integer, else null (§3.6: the URL is the source of truth). */
export function parseHubParam(raw: string | null): number | null {
    if (raw == null || !/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return id > 0 ? id : null;
}

/** The page's `?hub`, read from the URL. */
export function useLfgHubParam(): number | null {
    const [params] = useSearchParams();
    return parseHubParam(params.get('hub'));
}
