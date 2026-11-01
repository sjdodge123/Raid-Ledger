/**
 * ROK-1955 / ROK-2056 — the Companion card on My Integrations
 * (`/profile/integrations#companion` or `#companion-devices`, the /link
 * "Manage devices" target). While `COMPANION_DOWNLOAD_AVAILABLE` is false it
 * is the pre-release "Companion devices" card: the device list only — no
 * install content, no Beta chip (AC9, operator ruling Q5). Once a public
 * download exists it becomes "Raid Ledger Companion" + Beta. Not linked: how
 * to install it (open), then "Your computers". Linked (any active device):
 * the device list, then a collapsed "Install on another computer". Removing a
 * device asks first (Modal ≥1024px, BottomSheet below, §4.4) and revokes it.
 */
import { useState } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';
import type { CompanionDevice } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { useHashScrollIntoView } from '../../hooks/use-hash-scroll-into-view';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { useCompanionDevices, useRevokeCompanionDevice } from '../../hooks/use-companion-devices';
import { StatusChip } from '../../components/ui/status-chip';
import { COMPANION_CARD_ANCHOR, companionDownloadAvailable } from '../../lib/companion-install';
import { CompanionDeviceRow } from './companion-device-row';
import { CompanionInstallBlock } from './companion-install-block';

interface ConfirmProps { device: CompanionDevice; onClose: () => void }

/** Modal on desktop, BottomSheet on phone; mounted only while open. */
function ConfirmOverlay(props: { title: string; onClose: () => void; footer: ReactNode; children: ReactNode }): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    if (isDesktop) return <Modal isOpen {...props} />;
    return <BottomSheet isOpen {...props} />;
}

/** "Remove <name>?" — Remove revokes; nothing but the outcome closes it while pending. */
function RemoveDeviceConfirm({ device, onClose }: ConfirmProps): JSX.Element {
    const revoke = useRevokeCompanionDevice();
    const close = revoke.isPending ? (): void => undefined : onClose;
    const footer = (
        <>
            <Button variant="secondary" onClick={onClose} disabled={revoke.isPending}>Cancel</Button>
            <Button variant="destructive" loading={revoke.isPending} loadingLabel="Removing…"
                data-testid="companion-device-confirm-remove"
                onClick={() => revoke.mutate(device.id, { onSuccess: onClose })}>
                Remove
            </Button>
        </>
    );
    return (
        <ConfirmOverlay title="Remove device" onClose={close} footer={footer}>
            <p className="text-sm text-secondary">
                {`Remove ${device.name}? It stops uploading immediately and must be linked again to reconnect.`}
            </p>
            {revoke.isError && (
                <p role="alert" className="mt-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    Couldn't remove this device. Try again.
                </p>
            )}
        </ConfirmOverlay>
    );
}

/** §4.7 danger banner with a Retry. */
function LoadError({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }): JSX.Element {
    return (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 p-4">
            <p className="flex-1 text-sm text-danger">Couldn't load your devices.</p>
            <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying} loadingLabel="Retrying…">Retry</Button>
        </div>
    );
}

/** §4.5 quiet empty state with the next step. */
function EmptyDevices(): JSX.Element {
    return (
        <p className="text-sm text-muted">
            No computers linked yet.
        </p>
    );
}

/** The card's anchor: `/link`'s "Manage devices" lands here; `#companion` is an alias (ROK-2056). */
const SECTION_ID = 'companion-devices';
const HASH_ALIASES = [COMPANION_CARD_ANCHOR] as const;

const DESCRIPTION = 'Computers running the Raid Ledger Companion that can upload game data for you.';

type DevicesQuery = UseQueryResult<CompanionDevice[]>;

/** The list body for each query state; the empty state replaces the description (mockup §5). */
function DevicesBody({ devices, onRemove }: { devices: DevicesQuery; onRemove: (d: CompanionDevice) => void }): JSX.Element | null {
    if (devices.isError) return <LoadError onRetry={() => { void devices.refetch(); }} retrying={devices.isFetching} />;
    if (devices.data === undefined) return null;
    if (devices.data.length === 0) return <EmptyDevices />;
    return (
        <>
            <p className="text-sm text-muted mb-2">{DESCRIPTION}</p>
            <ul className="divide-y divide-edge">
                {devices.data.map((d) => <CompanionDeviceRow key={d.id} device={d} onRemove={onRemove} />)}
            </ul>
        </>
    );
}

interface CardBodyProps { devices: DevicesQuery; onRemove: (d: CompanionDevice) => void; canInstall: boolean }

/** Flag off: the list only. Not linked: install first, then "Your computers". Linked: the list, then the collapsed install block. */
function CardBody({ devices, onRemove, canInstall }: CardBodyProps): JSX.Element | null {
    if (devices.data === undefined && !devices.isError) return null;
    if (!canInstall) return <DevicesBody devices={devices} onRemove={onRemove} />;
    const linked = (devices.data ?? []).some((d) => d.state === 'active');
    if (linked) {
        return (<><DevicesBody devices={devices} onRemove={onRemove} /><CompanionInstallBlock linked /></>);
    }
    return (
        <>
            <CompanionInstallBlock linked={false} />
            <h3 className="mt-5 mb-2 border-t border-edge-subtle pt-4 text-base font-semibold text-foreground">Your computers</h3>
            <DevicesBody devices={devices} onRemove={onRemove} />
        </>
    );
}

const HEADING_ID = 'companion-devices-heading';
const HEADING_CLS = 'text-xl font-semibold text-foreground';

/** Pre-release: the unchanged "Companion devices" heading. Released: "Raid Ledger Companion" + Beta. */
function CardHeading({ canInstall }: { canInstall: boolean }): JSX.Element {
    if (!canInstall) return <h2 id={HEADING_ID} className={`${HEADING_CLS} mb-3`}>Companion devices</h2>;
    return (
        <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id={HEADING_ID} className={HEADING_CLS}>Raid Ledger Companion</h2>
            <StatusChip tone="neutral" title="Beta — test builds">Beta</StatusChip>
        </div>
    );
}

/** The Companion card. */
export function CompanionDevicesSection(): JSX.Element {
    const [removing, setRemoving] = useState<CompanionDevice | null>(null);
    const devices = useCompanionDevices();
    const canInstall = companionDownloadAvailable();
    useHashScrollIntoView(SECTION_ID, devices.data !== undefined || devices.isError, HASH_ALIASES);
    return (
        <section id={SECTION_ID} aria-labelledby={HEADING_ID}
            className="bg-surface border border-edge-subtle rounded-xl p-6 scroll-mt-20">
            <CardHeading canInstall={canInstall} />
            <CardBody devices={devices} onRemove={setRemoving} canInstall={canInstall} />
            {removing !== null && <RemoveDeviceConfirm device={removing} onClose={() => setRemoving(null)} />}
        </section>
    );
}
