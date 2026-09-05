/**
 * The game-detail page's LFG banner (ROK-1478 operator walk).
 *
 * REPLACES `LfgChip` at `GameBanner.tsx:95` — on the DETAIL PAGE ONLY. The
 * walk finding was "it's not obvious you can click that, and it's hard to
 * click on mobile": in the meta row the chip sat between the rating pill, the
 * genre pills and the price badge, all of which are static, so the row's one
 * interactive element was indistinguishable from its four decorations — and
 * its `px-2 py-0.5` box is a ~20px tap target.
 *
 * The card badge on the Games grid stays a chip: there it is one of several
 * badges overlaid on cover art, the tile itself is the tap target, and a
 * full-width banner per tile would be absurd. `lfg-chip.tsx` is untouched.
 *
 * The sentence comes from `lfg-chip-copy.ts` (ROK-1478 D4), the same helper
 * behind the card badge and the events banner, so the three cannot describe
 * the same group differently. Only the leading 🎯 and the trailing call to
 * action are added here.
 *
 * COLOUR: every class below is one the ROK-464 light-mode block in
 * `index.css` remaps under `[data-scheme="light"]` (`bg-*-500/10`,
 * `border-*-500/30`, `text-*-400`), so the banner is legible on all twelve
 * schemes. Hover is `hover:opacity-90` — the chip's own theme-agnostic idiom
 * (`lfg-chip.tsx:31`) — rather than a tinted hover background, because the
 * hover-background overrides in that block cover a narrower set of shades.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { LfgState } from '@raid-ledger/contract';
import { effectiveLfgState, groupLine } from '../../components/lfg/lfg-chip-copy';

const BOX_CLS =
    'flex min-h-[44px] w-full flex-wrap items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-90';

/**
 * Tonal fill per state, matching the chip's hues: emerald for a group that has
 * formed ("join them"), amber for one still recruiting ("they need you").
 */
const STATE_CLS: Record<'lfg' | 'lfm', string> = {
    lfm: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
    lfg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
};

export interface GameDetailLfgBannerProps {
    /** Eligible active intents. Nothing renders at 0 or `undefined`. */
    activeCount?: number | null;
    /** `games.cooptimusOnlineMax`, when Co-Optimus knows the group size. */
    viabilityThreshold?: number | null;
    /** Server-derived state; falls back to the count when absent. */
    state?: LfgState;
    /** `games.slug` — the banner navigates to `/lfg/{gameSlug}`. */
    gameSlug: string;
}

/**
 * The rendered banner. Split from `GameDetailLfgBanner` so the router is only
 * reached when there IS a banner — the same reason `LfgChip` splits, and it
 * keeps a zero-intent detail page renderable outside a `<Router>`.
 */
function LfgBannerLink({
    activeCount,
    viabilityThreshold,
    state,
    gameSlug,
}: GameDetailLfgBannerProps & { activeCount: number }): JSX.Element {
    const effectiveState = effectiveLfgState(activeCount, state);
    const line = groupLine(activeCount, effectiveState, viabilityThreshold);
    const label = `🎯 ${line} — Join →`;

    return (
        <Link
            to={`/lfg/${gameSlug}`}
            data-testid="game-detail-lfg-banner"
            data-lfg-state={effectiveState}
            aria-label={label}
            className={`${BOX_CLS} ${STATE_CLS[effectiveState]}`}
        >
            {label}
        </Link>
    );
}

/**
 * A full-width banner linking to the game's LFG group. Renders nothing when
 * nobody is looking — the same gate as the chip it replaces, so a detail page
 * with no interest gains no empty row.
 *
 * @param props - Group shape and the slug the banner opens.
 */
export function GameDetailLfgBanner(
    props: GameDetailLfgBannerProps,
): JSX.Element | null {
    const { activeCount } = props;
    if (!activeCount || activeCount < 1) return null;
    return <LfgBannerLink {...props} activeCount={activeCount} />;
}
