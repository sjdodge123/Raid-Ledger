/**
 * ROK-2129 spike: the Battle.net account probe's last run, keys only — token
 * response key names + booleans, one row per `/profile/user/wow` namespace
 * with its status, counts and key unions, and the ID-parity counts. Every
 * field is rendered explicitly from the contract shape, so nothing outside it
 * (a name, realm or token) can reach the screen.
 */
import type { JSX } from 'react';
import type {
    BnetProbeAccountSummary,
    BnetProbeIdParity,
    BnetProbeNamespaceResult,
    BnetProbeResult,
    BnetProbeTokenSummary,
} from '@raid-ledger/contract';

/** `1 account` / `7 characters`. */
function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function list(values: string[]): string {
    return values.length === 0 ? '—' : values.join(', ');
}

function yesNo(value: boolean): string {
    return value ? 'yes' : 'no';
}

/** One `label: value` line; the value sits in its own element so it reads (and tests) as a unit. */
function Row({ label, value }: { label: string; value: string }): JSX.Element {
    return (
        <li>
            <span className="text-muted">{label}:</span> <span className="text-foreground">{value}</span>
        </li>
    );
}

function TokenRows({ token }: { token: BnetProbeTokenSummary }): JSX.Element {
    return (
        <ul aria-label="Token response" className="space-y-0.5">
            <Row label="Token call" value={`HTTP ${token.status} from ${token.host}`} />
            <Row label="Keys" value={list(token.keys)} />
            <Row label="expires_in" value={token.expiresIn === null ? '—' : String(token.expiresIn)} />
            <Row label="Scope granted" value={token.scope ?? '—'} />
            <Row label="Refresh token" value={yesNo(token.refreshTokenIssued)} />
            <Row label="ID token" value={yesNo(token.idTokenIssued)} />
            <Row label="PKCE accepted" value={yesNo(token.pkceAccepted)} />
        </ul>
    );
}

function nestedLine(nested: Record<string, string[]>): string {
    const keys = Object.keys(nested).sort();
    return keys.length === 0 ? '—' : keys.map((k) => `${k} (${list(nested[k] ?? [])})`).join('; ');
}

function frequencyLine(freq: Record<string, number>): string {
    const keys = Object.keys(freq).sort();
    return keys.length === 0 ? '—' : keys.map((k) => `${k} ${freq[k] ?? 0}`).join(' · ');
}

function SummaryRows({ summary }: { summary: BnetProbeAccountSummary }): JSX.Element {
    const h = summary.hrefShapes;
    return (
        <ul className="ml-4 space-y-0.5">
            <Row label="Top-level keys" value={list(summary.topLevelKeys)} />
            <Row label="Account keys" value={list(summary.accountKeys)} />
            <Row label="Character keys" value={list(summary.characterKeys)} />
            <Row label="Character key frequency" value={frequencyLine(summary.characterKeyFrequency)} />
            <Row label="Nested keys" value={nestedLine(summary.nestedKeys)} />
            <Row label="Character hrefs" value={`realmless ${h.realmless} · realm ${h.realm} · none ${h.none}`} />
        </ul>
    );
}

function namespaceStatus(ns: BnetProbeNamespaceResult): string {
    const head = ns.status === null ? (ns.error ?? 'no response') : `HTTP ${ns.status}`;
    if (!ns.summary) return head;
    return `${head} · ${plural(ns.summary.wowAccountCount, 'account')} · ${plural(ns.summary.characterCount, 'character')}`;
}

function NamespaceRows({ namespaces }: { namespaces: BnetProbeNamespaceResult[] }): JSX.Element {
    return (
        <ul aria-label="Account summary by namespace" className="space-y-2">
            {namespaces.map((ns) => (
                <li key={ns.namespace}>
                    <code className="text-foreground">{ns.namespace}</code> <span className="text-secondary">{namespaceStatus(ns)}</span>
                    {ns.summary && <SummaryRows summary={ns.summary} />}
                </li>
            ))}
        </ul>
    );
}

function ParityRows({ parity }: { parity: BnetProbeIdParity }): JSX.Element {
    const counts = `checked ${parity.checked} · matched ${parity.matched} · mismatched ${parity.mismatched} · not found ${parity.notFound} · errors ${parity.errors}`;
    return (
        <ul aria-label="ID parity" className="space-y-0.5">
            <Row label="Realmless lookups (app token)" value={counts} />
            <Row label="Built from" value={`href ${parity.viaHref} · name ${parity.viaName}`} />
        </ul>
    );
}

/** The latest Battle.net probe run, keys and counts only; a placeholder line before the first run. */
export function BnetAccountProbeResult({ result }: { result: BnetProbeResult | null }): JSX.Element {
    if (!result) return <p className="text-sm text-muted">The probe has not run yet.</p>;
    return (
        <div className="space-y-3 text-sm text-secondary">
            <p>
                Last run {new Date(result.at).toLocaleString()} · region {result.region} · scope {result.scopeRequested}
                {result.error && <> · <span className="font-medium text-danger">ended with: {result.error}</span></>}
            </p>
            {result.token && <TokenRows token={result.token} />}
            {result.namespaces.length > 0 && <NamespaceRows namespaces={result.namespaces} />}
            {result.idParity && <ParityRows parity={result.idParity} />}
        </div>
    );
}
