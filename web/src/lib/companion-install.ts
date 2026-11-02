/**
 * ROK-2056 — the web's single read of the Companion download flag and the
 * in-app href every install entry point links to. Kept as a tiny module so
 * tests can `vi.mock('…/lib/companion-install')` and exercise both states of
 * `COMPANION_DOWNLOAD_AVAILABLE` (`true` since ROK-2060 — ROK-2057's first
 * public release).
 */
import { COMPANION_DOWNLOAD_AVAILABLE } from '@raid-ledger/contract';

/** The canonical install card on My Integrations (`#companion-devices` also works). */
export const COMPANION_CARD_HREF = '/profile/integrations#companion';

/** The card's second anchor id (the first, `companion-devices`, is the section id). */
export const COMPANION_CARD_ANCHOR = 'companion';

/** True once a public release exists; while false no download affordance renders. */
export function companionDownloadAvailable(): boolean {
    return COMPANION_DOWNLOAD_AVAILABLE;
}

/**
 * The inline-link idiom every Companion entry point uses (approved mockup
 * `a.link`, `--color-success`; the app's existing inline links).
 */
export const COMPANION_LINK_CLASS = 'text-success underline underline-offset-2 hover:text-foreground';
