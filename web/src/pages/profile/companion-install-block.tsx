/**
 * ROK-2056 — the install half of the "Raid Ledger Companion" card on My
 * Integrations (approved mockup panels A + B). Not linked: open, under the
 * heading. Linked: a collapsed "Install on another computer" disclosure under
 * the device list. While `COMPANION_DOWNLOAD_AVAILABLE` is false the Download
 * button, formats caption and unsigned-build note do not render; the steps do.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { COMPANION_DOWNLOAD_FORMATS, COMPANION_DOWNLOAD_URL, COMPANION_UNSIGNED_NOTE } from '@raid-ledger/contract';
import { buttonClass } from '../../components/ui/button-classes';
import { companionDownloadAvailable } from '../../lib/companion-install';

const INTRO = "A small desktop app that sends game data Raid Ledger can't get on its own — Baldur's Gate 3 saves, "
    + 'LedgerLink exports — to the hubs you play in. You choose which games it reads.';

const LINK_CLS = 'text-secondary underline underline-offset-2 hover:text-foreground';

/** Download (new tab) + what the releases page offers. */
function DownloadRow(): JSX.Element {
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <a href={COMPANION_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer"
                data-testid="companion-download"
                className={`${buttonClass({ variant: 'primary' })} w-full sm:w-auto`}>
                Download
            </a>
            <span data-testid="companion-download-formats" className="text-xs text-dim">
                {`${COMPANION_DOWNLOAD_FORMATS} · opens the releases page`}
            </span>
        </div>
    );
}

/** Install → open → "Link this computer" and enter the code at /link. */
function InstallSteps(): JSX.Element {
    return (
        <ol data-testid="companion-install-steps" className="my-3 list-decimal space-y-1 pl-5 text-sm text-secondary">
            <li>Install it and open it.</li>
            <li>Choose <strong className="text-foreground">Link this computer</strong>. It shows an 8-letter code.</li>
            <li>
                Enter the code at <Link to="/link" className={LINK_CLS}>/link</Link>, then turn on the games you
                want it to read.
            </li>
        </ol>
    );
}

/** §4.7 neutral instruction callout — removed once ROK-1963 signs the builds. */
function UnsignedNote(): JSX.Element {
    return (
        <div data-testid="companion-unsigned-note"
            className="rounded-lg border border-edge bg-overlay/30 p-3 text-sm text-secondary">
            <strong className="text-foreground">Unsigned test build.</strong>
            {` ${COMPANION_UNSIGNED_NOTE.windows} ${COMPANION_UNSIGNED_NOTE.macos}`}
        </div>
    );
}

/** The install content: Download row, steps, unsigned note. */
function InstallBody({ showIntro }: { showIntro: boolean }): JSX.Element {
    const canDownload = companionDownloadAvailable();
    return (
        <div data-testid="companion-install">
            {showIntro && <p className="mb-3 text-sm text-muted">{INTRO}</p>}
            {canDownload && <DownloadRow />}
            <InstallSteps />
            {canDownload && <UnsignedNote />}
        </div>
    );
}

/** Open while not linked; a collapsed disclosure once a device is linked. */
export function CompanionInstallBlock({ linked }: { linked: boolean }): JSX.Element {
    if (!linked) return <InstallBody showIntro />;
    return (
        <details data-testid="companion-install-more" className="group/install mt-2 border-t border-edge-subtle">
            <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 text-sm font-medium text-foreground select-none">
                <span aria-hidden="true" className="text-dim transition-transform group-open/install:rotate-90">▸</span>
                Install on another computer
            </summary>
            <div className="pb-1 pl-5"><InstallBody showIntro={false} /></div>
        </details>
    );
}
