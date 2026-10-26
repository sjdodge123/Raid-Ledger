/**
 * ROK-1955 — "Companion devices" card on My Integrations
 * (`/profile/integrations#companion-devices`, the /link "Manage devices"
 * target). Lists the computers linked with a device token; removing one asks
 * first (Modal ≥1024px, BottomSheet below, §4.4) and revokes it at once.
 */
import { useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { CompanionDevice } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Modal } from '../../components/ui/modal';
import { BottomSheet } from '../../components/ui/bottom-sheet';
import { useMediaQuery } from '../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../lib/breakpoints';
import { useCompanionDevices, useRevokeCompanionDevice } from '../../hooks/use-companion-devices';
import { CompanionDeviceRow } from './companion-device-row';

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
            No computers linked. Install the Raid Ledger Companion and choose <strong>Link this computer</strong>
            {' '}— it shows a code to enter at /link.
        </p>
    );
}

const DESCRIPTION = 'Computers running the Raid Ledger Companion that can upload game data for you.';

/** The list body for each query state; the empty state replaces the description (mockup §5). */
function DevicesBody({ onRemove }: { onRemove: (d: CompanionDevice) => void }): JSX.Element | null {
    const devices = useCompanionDevices();
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

/** The Companion devices card. */
export function CompanionDevicesSection(): JSX.Element {
    const [removing, setRemoving] = useState<CompanionDevice | null>(null);
    return (
        <section id="companion-devices" aria-labelledby="companion-devices-heading"
            className="bg-surface border border-edge-subtle rounded-xl p-6 scroll-mt-20">
            <h2 id="companion-devices-heading" className="text-xl font-semibold text-foreground mb-3">Companion devices</h2>
            <DevicesBody onRemove={setRemoving} />
            {removing !== null && <RemoveDeviceConfirm device={removing} onClose={() => setRemoving(null)} />}
        </section>
    );
}
