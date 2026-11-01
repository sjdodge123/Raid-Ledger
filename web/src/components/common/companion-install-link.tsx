/**
 * ROK-2056 §3 L7 / L8 — one quiet `text-xs` line pointing at the canonical
 * Companion install card (My Integrations `#companion`). It never repeats the
 * steps. Renders only while a public download exists AND the viewer has no
 * active Companion device (a revoked-only viewer counts as not linked).
 *
 * Mount it only after the host's own gate passes (member, empty state, open
 * sheet): the device list is fetched on mount, sharing `COMPANION_DEVICES_KEY`.
 * While the list is loading or failed it stays silent.
 */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { useCompanionDevices } from '../../hooks/use-companion-devices';
import { COMPANION_CARD_HREF, COMPANION_LINK_CLASS, companionDownloadAvailable } from '../../lib/companion-install';

export interface CompanionInstallLinkProps {
    /** Words before the link, e.g. "Saves can upload by themselves —". */
    readonly lead: string;
    /** The link text. */
    readonly label?: string | undefined;
    readonly className?: string | undefined;
}

export function CompanionInstallLink(props: CompanionInstallLinkProps): JSX.Element | null {
    if (!companionDownloadAvailable()) return null;
    return <UnlinkedLine {...props} />;
}

function UnlinkedLine({ lead, label = 'install the Companion', className }: CompanionInstallLinkProps): JSX.Element | null {
    const { data } = useCompanionDevices();
    if (data === undefined || data.some((d) => d.state === 'active')) return null;
    return (
        <p data-testid="companion-install-link" className={`text-xs text-dim${className ? ` ${className}` : ''}`}>
            {lead}{' '}
            <Link to={COMPANION_CARD_HREF} className={COMPANION_LINK_CLASS}>
                {label}
            </Link>
            .
        </p>
    );
}
