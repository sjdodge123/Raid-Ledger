import type { JSX } from 'react';
import type { GameDetailDto } from '@raid-ledger/contract';
import { CoopProseBlocks } from './CoopProseBlocks';

/**
 * Co-Optimus co-op section for the game detail page (ROK-1398).
 *
 * Three states:
 *   never-synced (`cooptimusSyncedAt` null) — renders nothing, no layout hole
 *   synced-empty — Co-Optimus was asked and has no entry: one compact line
 *   enriched     — the fact blocks, any prose the API shipped, and the credit
 *
 * The attribution credit is CONTRACTUAL (ROK-275 grant / ROK-1399): whenever a
 * co-op fact is on screen, "Co-op data from Co-Optimus" must be on screen with
 * it. If a test guarding that fails, restore the credit — never the assertion.
 */

/** Exact wording agreed with Co-Optimus. Do not reword. */
const CREDIT_TEXT = 'Co-op data from Co-Optimus';

/** Player-count facts, in display order. */
const COUNT_FACTS = [
    { key: 'cooptimusOnlineMax', label: 'Online Co-Op' },
    { key: 'cooptimusCouchMax', label: 'Local Co-Op' },
    { key: 'cooptimusLanMax', label: 'LAN Play or System Link' },
] as const;

/**
 * Boolean facts, split across the two blocks. A `null` value means "we could
 * not determine it" and the row is OMITTED — never rendered as "Not Supported".
 */
const CORE_FLAGS = [
    { key: 'cooptimusComboCoop', label: 'Combo Co-Op (Local + Online)' },
] as const;
const EXTRA_FLAGS = [
    { key: 'cooptimusCampaignCoop', label: 'Campaign Co-Op' },
    { key: 'cooptimusDropIn', label: 'Drop In/Drop Out' },
    { key: 'cooptimusSplitscreen', label: 'Split-Screen' },
] as const;

/**
 * Page-derived facts (combo co-op, downloadable-only) are trustworthy only when
 * extras records that a page read actually succeeded. Rows written before
 * page-sourcing hold `false` from a regex over a field that never contained
 * those tokens, so without this gate they keep rendering "Not Supported" until
 * a re-sync — the exact false claim, under the Co-Optimus credit, that this is
 * meant to remove. Absent provenance ⇒ omit the row.
 */
function hasPageProvenance(game: GameDetailDto): boolean {
    return game.cooptimusExtras?.pageFactsAt != null;
}

/** True once Co-Optimus reported an entry — a 0 count or `false` flag still counts. */
function hasCoopEntry(game: GameDetailDto): boolean {
    return [...COUNT_FACTS, ...CORE_FLAGS, ...EXTRA_FLAGS].some(
        (f) => game[f.key] != null,
    );
}

export function CoopFeaturesSection({ game }: { game: GameDetailDto }): JSX.Element | null {
    if (!game.cooptimusSyncedAt) return null;
    const enriched = hasCoopEntry(game);

    return (
        <section className="mb-8" data-testid="coop-features-section">
            <h2 className="text-lg font-semibold text-foreground mb-3">Co-Op Support</h2>
            {enriched ? (
                <div className="bg-panel border border-edge rounded-lg p-4 space-y-4">
                    <CoreFeaturesBlock game={game} />
                    <CoopExtrasBlock game={game} />
                    <CoopProseBlocks extras={game.cooptimusExtras} />
                    <CooptimusCredit url={game.cooptimusUrl ?? null} />
                </div>
            ) : (
                <div className="bg-panel border border-edge rounded-lg p-4">
                    <p className="text-sm text-muted italic">No co-op support reported.</p>
                    <CooptimusCredit url={game.cooptimusUrl ?? null} />
                </div>
            )}
        </section>
    );
}

/** Player counts plus combo co-op. */
function CoreFeaturesBlock({ game }: { game: GameDetailDto }): JSX.Element | null {
    const counts = COUNT_FACTS.filter((f) => game[f.key] != null);
    const flags = hasPageProvenance(game)
        ? CORE_FLAGS.filter((f) => game[f.key] != null)
        : [];
    if (counts.length === 0 && flags.length === 0) return null;

    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Core Features</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {counts.map((f) => (
                    <Fact key={f.key} label={f.label} supported={(game[f.key] as number) > 0}
                        value={countLabel(game[f.key] as number)} />
                ))}
                {flags.map((f) => (
                    <Fact key={f.key} label={f.label} supported={game[f.key] === true}
                        value={coreFlagLabel(game, f.key)} />
                ))}
            </div>
        </div>
    );
}

/**
 * Prefer Co-Optimus's own combo wording ("Up to 4 Local or Online") over a bare
 * "Supported" — their page is the only source for this fact, so we echo it
 * verbatim rather than paraphrase it underneath their credit.
 */
function coreFlagLabel(
    game: GameDetailDto,
    key: (typeof CORE_FLAGS)[number]['key'],
): string {
    if (key === 'cooptimusComboCoop' && game[key] === true) {
        return game.cooptimusExtras?.comboLabel ?? flagLabel(true);
    }
    return flagLabel(game[key] as boolean);
}

/** Campaign / drop-in / split-screen, plus the page-derived Downloadable Only. */
function CoopExtrasBlock({ game }: { game: GameDetailDto }): JSX.Element | null {
    const flags = EXTRA_FLAGS.filter((f) => game[f.key] != null);
    const downloadableOnly = hasPageProvenance(game)
        ? game.cooptimusExtras?.downloadableOnly
        : null;
    if (flags.length === 0 && downloadableOnly == null) return null;

    return (
        <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Co-Op Extras</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                {flags.map((f) => (
                    <Fact key={f.key} label={f.label} supported={game[f.key] === true}
                        value={flagLabel(game[f.key] as boolean)} />
                ))}
                {downloadableOnly != null && (
                    <Fact label="Downloadable Only" supported={downloadableOnly}
                        value={downloadableOnly ? 'Yes' : 'No'} />
                )}
            </div>
        </div>
    );
}

/** `0` is a reported fact ("Not Supported"), not a missing one. */
function countLabel(max: number): string {
    return max > 0 ? `Up to ${max} players` : 'Not Supported';
}

function flagLabel(value: boolean): string {
    return value ? 'Supported' : 'Not Supported';
}

/** One label/value pair, styled like the Crossplay row in the banner's details grid. */
function Fact({ label, value, supported }: {
    label: string; value: string; supported: boolean;
}): JSX.Element {
    return (
        <div>
            <span className="text-dim">{label}</span>
            <p className={`font-medium ${supported ? 'text-emerald-400' : 'text-secondary'}`}>{value}</p>
        </div>
    );
}

/**
 * Attribution credit. Linked to the Co-Optimus game page when we have the url;
 * plain text otherwise (defensive — sync always sets a url on a match).
 */
function CooptimusCredit({ url }: { url: string | null }): JSX.Element {
    // Scheme allowlist: the URL is DB-sourced (sync/admin pin) — never render
    // a non-http(s) value as a clickable href.
    const safeUrl = url && /^https?:\/\//i.test(url) ? url : null;
    return (
        <p className="text-xs text-muted pt-1">
            {safeUrl ? (
                <a href={safeUrl} target="_blank" rel="noopener noreferrer"
                    data-testid="cooptimus-credit"
                    className="text-muted hover:text-foreground underline transition-colors">
                    {CREDIT_TEXT}
                </a>
            ) : (
                <span data-testid="cooptimus-credit">{CREDIT_TEXT}</span>
            )}
        </p>
    );
}
