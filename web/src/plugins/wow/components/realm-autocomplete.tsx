import { useMemo } from 'react';
import { Combobox } from '../../../components/ui/combobox';
import { useWowRealms } from '../hooks/use-wow-realms';

type RealmsResponse = ReturnType<typeof useWowRealms>['data'];
type Realm = NonNullable<RealmsResponse>['data'][number];

interface RealmAutocompleteProps {
    region: string;
    value: string;
    onChange: (realm: string) => void;
    /** WoW game variant for Blizzard API namespace (retail, classic_era, classic) */
    gameVariant?: string;
    /** Accessible name. Omit inside a `Field` — the Combobox takes the Field's label. */
    label?: string;
}

/** Realms whose name contains the typed text (first 20 before any typing). */
function useRealmFiltered(data: RealmsResponse, value: string) {
    return useMemo(() => {
        const realms = data?.data ?? [];
        if (!value.trim()) return realms.slice(0, 20);
        const lower = value.toLowerCase();
        return realms.filter((r) => r.name.toLowerCase().includes(lower)).slice(0, 20);
    }, [data, value]);
}

/** The realm the text names exactly (case-insensitive), so the popup marks it selected; else null. */
function useMatchedRealm(data: RealmsResponse, value: string): Realm | null {
    return useMemo(() => {
        if (!value) return null;
        const lower = value.toLowerCase();
        return data?.data.find((r) => r.name.toLowerCase() === lower) ?? null;
    }, [data, value]);
}

const REALM_LOAD_FALLBACK = "Couldn't load realms for this region.";

/** ROK-1636: the API's readable message when it sent one; fetchApi's bare `HTTP 502` / `Request failed` get the fallback. */
function realmLoadErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message.trim() : '';
    if (!message || /^HTTP \d+$/.test(message) || message === 'Request failed') return REALM_LOAD_FALLBACK;
    return message;
}

function RealmLoadError({ error }: { error: unknown }) {
    return <p role="alert" className="mt-1 text-xs text-danger">{realmLoadErrorMessage(error)}</p>;
}

/**
 * Autocomplete for WoW realm names (ROK-234 UX; the shared Combobox since ROK-1654).
 * Fetches the realm list from the Blizzard API and filters client-side. The text is
 * controlled by `value`, so a free-typed realm still reaches the parent; picking an
 * option writes its name. The load error sits outside the popup so it shows unopened.
 */
export function RealmAutocomplete({ region, value, onChange, gameVariant, label }: RealmAutocompleteProps) {
    const { data, isLoading, isError, error } = useWowRealms(region, gameVariant);
    const filtered = useRealmFiltered(data, value);
    const matched = useMatchedRealm(data, value);
    return (
        <div>
            <Combobox<Realm>
                options={filtered} getKey={(r) => String(r.id)} getLabel={(r) => r.name}
                value={matched} onChange={(r) => { if (r) onChange(r.name); }}
                inputValue={value} onInputChange={onChange}
                label={label} placeholder="Realm Name" loading={isLoading} openOnFocus
            />
            {isError && <RealmLoadError error={error} />}
        </div>
    );
}
