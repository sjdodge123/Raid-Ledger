/**
 * Unit tests for CoopFeaturesSection (ROK-1398).
 *
 * TDD — written BEFORE the component exists. Every test here must fail until
 * `./CoopFeaturesSection` is implemented.
 *
 * Contract the implementation must satisfy (see planning-artifacts/specs/ROK-1398.md):
 *   - default export shape: `export function CoopFeaturesSection({ game }: { game: GameDetailDto })`
 *   - root element carries `data-testid="coop-features-section"` whenever it renders
 *   - attribution credit text is exactly "Co-op data from Co-Optimus", linked to
 *     `game.cooptimusUrl` when present (target=_blank, rel includes noopener)
 *
 * NOTE: the Co-Optimus HTTP user-agent is deliberately NOT referenced anywhere in
 * this file (ROK-275 grant condition — it is the activation gate and must never be
 * committed to a public repo).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GameDetailDto, CooptimusExtrasDto } from '@raid-ledger/contract';
import { CoopFeaturesSection } from './CoopFeaturesSection';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SECTION = 'coop-features-section';
const CREDIT = /co-op data from co-optimus/i;
const COOPTIMUS_URL = 'https://www.co-optimus.com/game/4471/pc/example.html';

/** Minimal GameDetailDto with no Co-Optimus enrichment at all (never-synced). */
function buildGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return {
        id: 42,
        igdbId: 1234,
        name: 'Deep Rock Galactic',
        slug: 'deep-rock-galactic',
        coverUrl: null,
        genres: [],
        summary: 'Dwarves mine things.',
        rating: null,
        aggregatedRating: null,
        popularity: null,
        gameModes: [],
        themes: [],
        platforms: [],
        screenshots: [],
        videos: [],
        firstReleaseDate: null,
        playerCount: { min: 1, max: 4 },
        twitchGameId: null,
        crossplay: null,
        cooptimusOnlineMax: null,
        cooptimusCouchMax: null,
        cooptimusLanMax: null,
        cooptimusSplitscreen: null,
        cooptimusDropIn: null,
        cooptimusCampaignCoop: null,
        cooptimusComboCoop: null,
        cooptimusUrl: null,
        cooptimusSyncedAt: null,
        cooptimusExtras: null,
        ...overrides,
    };
}

/** A game Co-Optimus has been asked about but which has no co-op entry. */
function buildSyncedEmptyGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return buildGame({ cooptimusSyncedAt: '2026-08-18T00:00:00.000Z', ...overrides });
}

/** Enriched game — facts only. Prose is absent, mirroring the flag-OFF response. */
function buildEnrichedGame(overrides: Partial<GameDetailDto> = {}): GameDetailDto {
    return buildGame({
        cooptimusSyncedAt: '2026-08-18T00:00:00.000Z',
        cooptimusOnlineMax: 4,
        cooptimusCouchMax: 2,
        cooptimusLanMax: 4,
        cooptimusSplitscreen: true,
        cooptimusDropIn: true,
        cooptimusCampaignCoop: true,
        cooptimusComboCoop: true,
        cooptimusUrl: COOPTIMUS_URL,
        cooptimusExtras: { system: 'PC', downloadableOnly: true, pageFactsAt: '2026-08-23T00:00:00.000Z' },
        ...overrides,
    });
}

/** Extras blob as returned when the operator has enabled prose (flag ON). */
function proseExtras(overrides: Partial<CooptimusExtrasDto> = {}): CooptimusExtrasDto {
    return {
        system: 'PC',
        downloadableOnly: true,
        pageFactsAt: '2026-08-23T00:00:00.000Z',
        coopExperience: 'Four dwarves dig, shoot, and lose the drop pod together.',
        description: 'A co-op first-person shooter about dwarves mining in space.',
        ...overrides,
    };
}

/** Full rendered text of the section — resilient to markup/Tailwind churn. */
function sectionText(): string {
    return screen.getByTestId(SECTION).textContent ?? '';
}

// ─── AC2: visibility gating ──────────────────────────────────────────────────

describe('CoopFeaturesSection — visibility gating (AC2)', () => {
    it('renders nothing when the game has never been synced with Co-Optimus', () => {
        const { container } = render(<CoopFeaturesSection game={buildGame()} />);
        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByTestId(SECTION)).not.toBeInTheDocument();
    });

    it('leaves no layout hole when never-synced — no heading, no credit', () => {
        render(<CoopFeaturesSection game={buildGame()} />);
        expect(screen.queryByText(CREDIT)).not.toBeInTheDocument();
        expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    });

    it('renders the compact "no co-op support reported" line when synced with no entry', () => {
        render(<CoopFeaturesSection game={buildSyncedEmptyGame()} />);
        expect(sectionText()).toMatch(/no co-op support reported/i);
    });

    it('does not render feature blocks in the synced-empty state', () => {
        render(<CoopFeaturesSection game={buildSyncedEmptyGame()} />);
        const text = sectionText();
        expect(text).not.toMatch(/not supported/i);
        expect(text).not.toMatch(/drop.?in/i);
    });
});

// ─── AC1: four blocks + Not Supported states ─────────────────────────────────

describe('CoopFeaturesSection — core features and extras (AC1)', () => {
    it('renders the online, local, LAN and combo co-op facts with their player counts', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        const text = sectionText();
        expect(text).toMatch(/online[\s\S]{0,40}4/i);
        expect(text).toMatch(/(local|couch)[\s\S]{0,40}2/i);
        expect(text).toMatch(/lan[\s\S]{0,40}4/i);
        expect(text).toMatch(/combo/i);
    });

    it('renders the Co-Op Extras facts (campaign, drop in/drop out, downloadable only)', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        const text = sectionText();
        expect(text).toMatch(/campaign/i);
        expect(text).toMatch(/drop.?in/i);
        expect(text).toMatch(/downloadable only/i);
    });

    it('shows "Not Supported" — not a hidden row — when a count is present but zero', () => {
        render(
            <CoopFeaturesSection
                game={buildEnrichedGame({ cooptimusLanMax: 0, cooptimusCouchMax: 0 })}
            />,
        );
        const text = sectionText();
        expect(text).toMatch(/lan/i);
        expect(text).toMatch(/not supported/i);
        // Online co-op is still supported, so the section is not uniformly negative.
        expect(text).toMatch(/online[\s\S]{0,40}4/i);
    });

    it('shows "Not Supported" for a false boolean flag rather than omitting it', () => {
        render(
            <CoopFeaturesSection
                game={buildEnrichedGame({ cooptimusComboCoop: false, cooptimusCampaignCoop: false })}
            />,
        );
        const text = sectionText();
        expect(text).toMatch(/combo/i);
        expect(text).toMatch(/campaign/i);
        expect(text).toMatch(/not supported/i);
    });

    it('renders numeric facts when the extras blob is entirely absent', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame({ cooptimusExtras: null })} />);
        const text = sectionText();
        expect(text).toMatch(/online[\s\S]{0,40}4/i);
        // Extras-derived items are simply absent — not an error, not a hole.
        expect(text).not.toMatch(/downloadable only/i);
    });
});

// ─── AC3: attribution link ───────────────────────────────────────────────────

describe('CoopFeaturesSection — attribution link (AC3)', () => {
    it('links the credit to the Co-Optimus game page', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        const link = screen.getByRole('link', { name: CREDIT });
        expect(link).toHaveAttribute('href', COOPTIMUS_URL);
    });

    it('opens the Co-Optimus page in a new tab without leaking the opener', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        const link = screen.getByRole('link', { name: CREDIT });
        expect(link).toHaveAttribute('target', '_blank');
        expect(link.getAttribute('rel') ?? '').toMatch(/noopener/);
    });

    it('renders the credit as plain text when cooptimusUrl is null', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame({ cooptimusUrl: null })} />);
        expect(screen.getByText(CREDIT)).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: CREDIT })).not.toBeInTheDocument();
    });
});

// ─── AC5: attribution presence is contractual (ROK-1399 cross-obligation) ────

describe('CoopFeaturesSection — attribution is contractual (AC5)', () => {
    // This is the promise made to the Co-Optimus site owner in exchange for the
    // data grant (ROK-275 / ROK-1399). If any co-op fact is on screen, the credit
    // MUST be on screen with it. Do NOT relax or delete this test — if a future
    // change makes it fail, the fix is to restore the credit, not the assertion.
    const enrichedVariants: [string, GameDetailDto][] = [
        ['facts only, prose off', buildEnrichedGame()],
        [
            'facts plus prose',
            buildEnrichedGame({ cooptimusExtras: proseExtras() }),
        ],
        ['no attribution url', buildEnrichedGame({ cooptimusUrl: null })],
        ['numeric facts only', buildEnrichedGame({ cooptimusExtras: null })],
        [
            'single supported feature',
            buildGame({
                cooptimusSyncedAt: '2026-08-18T00:00:00.000Z',
                cooptimusOnlineMax: 2,
                cooptimusUrl: COOPTIMUS_URL,
            }),
        ],
        [
            'all features unsupported but entry exists',
            buildEnrichedGame({
                cooptimusOnlineMax: 0,
                cooptimusCouchMax: 0,
                cooptimusLanMax: 0,
                cooptimusSplitscreen: false,
                cooptimusDropIn: false,
                cooptimusCampaignCoop: false,
                cooptimusComboCoop: false,
            }),
        ],
    ];

    it.each(enrichedVariants)(
        'renders the Co-Optimus credit whenever co-op facts render (%s)',
        (_label, game) => {
            render(<CoopFeaturesSection game={game} />);
            expect(screen.getByTestId(SECTION)).toBeInTheDocument();
            expect(screen.getByText(CREDIT)).toBeInTheDocument();
        },
    );

    it('uses the exact credit wording agreed with Co-Optimus', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        expect(screen.getByText('Co-op data from Co-Optimus')).toBeInTheDocument();
    });
});

// ─── AC4: prose renders purely on field presence (server-side gating) ────────

describe('CoopFeaturesSection — prose gating by field presence (AC4)', () => {
    it('renders facts with no prose headings when the API omitted the prose fields', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame()} />);
        const text = sectionText();
        expect(text).toMatch(/online[\s\S]{0,40}4/i);
        expect(text).not.toMatch(/the co-op experience/i);
    });

    it('renders the Co-Op Experience blurb when the API supplied it', () => {
        render(
            <CoopFeaturesSection game={buildEnrichedGame({ cooptimusExtras: proseExtras() })} />,
        );
        const text = sectionText();
        expect(text).toMatch(/the co-op experience/i);
        expect(text).toContain('Four dwarves dig, shoot, and lose the drop pod together.');
    });

    it('renders the Co-Optimus description with an expand control when supplied', async () => {
        const user = userEvent.setup();
        render(
            <CoopFeaturesSection game={buildEnrichedGame({ cooptimusExtras: proseExtras() })} />,
        );
        expect(sectionText()).toContain(
            'A co-op first-person shooter about dwarves mining in space.',
        );
        const toggle = screen.getByRole('button', { name: /more|expand/i });
        await user.click(toggle);
        expect(screen.getByRole('button', { name: /less|collapse/i })).toBeInTheDocument();
    });

    it('treats empty-string prose as absent', () => {
        render(
            <CoopFeaturesSection
                game={buildEnrichedGame({
                    cooptimusExtras: proseExtras({ coopExperience: '', description: '' }),
                })}
            />,
        );
        const text = sectionText();
        expect(text).not.toMatch(/the co-op experience/i);
        // Facts survive — the flag only strips prose.
        expect(text).toMatch(/online[\s\S]{0,40}4/i);
        expect(screen.getByText(CREDIT)).toBeInTheDocument();
    });

    it('renders prose without a layout hole when only one prose field is present', () => {
        render(
            <CoopFeaturesSection
                game={buildEnrichedGame({
                    cooptimusExtras: proseExtras({ description: null }),
                })}
            />,
        );
        expect(sectionText()).toMatch(/the co-op experience/i);
        expect(screen.queryByRole('button', { name: /more|expand/i })).not.toBeInTheDocument();
    });
});

describe('combo co-op is sourced from the Co-Optimus game page', () => {
    /**
     * games.php returns no combo element at all — the fact lives only on the
     * rendered page. Baldur's Gate III showed "Not Supported" here while
     * co-optimus.com showed "Up to 4 Local or Online", because the old code
     * regex-matched a featurelist token the API never emits.
     */
    it('echoes their exact combo wording rather than a bare "Supported"', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame({
            cooptimusComboCoop: true,
            cooptimusExtras: { system: 'PC', comboLabel: 'Up to 4 Local or Online', pageFactsAt: '2026-08-23T00:00:00.000Z' },
        })} />);
        expect(screen.getByText('Up to 4 Local or Online')).toBeInTheDocument();
    });

    it('falls back to "Supported" when the page gave no wording', () => {
        // Other boolean facts nulled so "Supported" can only come from combo.
        render(<CoopFeaturesSection game={buildEnrichedGame({
            cooptimusComboCoop: true,
            cooptimusCampaignCoop: null,
            cooptimusDropIn: null,
            cooptimusSplitscreen: null,
            cooptimusExtras: { system: 'PC', pageFactsAt: '2026-08-23T00:00:00.000Z' },
        })} />);
        expect(screen.getByText('Combo Co-Op (Local + Online)')).toBeInTheDocument();
        expect(screen.getByText('Supported')).toBeInTheDocument();
    });

    it('OMITS the combo row entirely when unknown — never claims "Not Supported"', () => {
        // null = the page could not be read. Publishing a negative we cannot
        // source, underneath their attribution credit, is the bug this guards.
        render(<CoopFeaturesSection game={buildEnrichedGame({ cooptimusComboCoop: null })} />);
        expect(screen.queryByText('Combo Co-Op (Local + Online)')).not.toBeInTheDocument();
        expect(screen.getByText('Online Co-Op')).toBeInTheDocument();
    });

    it('still reports a genuine "Not Supported" the page actually stated', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame({
            cooptimusComboCoop: false,
            cooptimusCampaignCoop: null,
            cooptimusDropIn: null,
            cooptimusSplitscreen: null,
            cooptimusExtras: { system: 'PC', comboLabel: 'Not Supported', pageFactsAt: '2026-08-23T00:00:00.000Z' },
        })} />);
        expect(screen.getByText('Combo Co-Op (Local + Online)')).toBeInTheDocument();
        expect(screen.getByText('Not Supported')).toBeInTheDocument();
    });

    it('OMITS Downloadable Only when unknown', () => {
        render(<CoopFeaturesSection game={buildEnrichedGame({
            cooptimusExtras: { system: 'PC', downloadableOnly: null, pageFactsAt: '2026-08-23T00:00:00.000Z' },
        })} />);
        expect(screen.queryByText('Downloadable Only')).not.toBeInTheDocument();
    });
});

describe('legacy rows without page provenance', () => {
    it('omits combo + downloadable entirely when extras has no pageFactsAt', () => {
        // A row written by the old featurelist regex: false values that were
        // never on any page. Until it re-syncs, we must show nothing rather
        // than republish "Not Supported"/"No" under the Co-Optimus credit.
        render(<CoopFeaturesSection game={buildEnrichedGame({
            cooptimusComboCoop: false,
            cooptimusExtras: { system: 'PC', downloadableOnly: false },
        })} />);
        expect(screen.queryByText('Combo Co-Op (Local + Online)')).not.toBeInTheDocument();
        expect(screen.queryByText('Downloadable Only')).not.toBeInTheDocument();
        // The API-sourced facts are unaffected — they never came from the page.
        expect(screen.getByText('Online Co-Op')).toBeInTheDocument();
        expect(screen.getByText('Campaign Co-Op')).toBeInTheDocument();
    });
});
