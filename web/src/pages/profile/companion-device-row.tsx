/**
 * ROK-1955 — one Companion device row: OS glyph, name + status chip, last
 * seen / linked lines, and Rename (inline) / Remove for an active device.
 * A revoked row is dimmed and has no actions (the approved mockup's "Removed").
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { FormEvent, JSX } from 'react';
import { CompanionDeviceNameSchema } from '@raid-ledger/contract';
import type { CompanionDevice, CompanionDeviceOs } from '@raid-ledger/contract';
import { Button } from '../../components/ui/button';
import { Field } from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { StatusChip } from '../../components/ui/status-chip';
import { syncedAgo } from '../../lib/synced-ago';
import { useRenameCompanionDevice } from '../../hooks/use-companion-devices';

const OS_GLYPH: Record<CompanionDeviceOs, string> = { windows: 'W', macos: 'M', linux: 'L', other: '?' };
const LINKED_FMT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** Inline validation copy for a bad name (empty, too long, control chars). */
export const DEVICE_NAME_ERROR = 'Enter a name of up to 64 characters.';

interface RowProps { device: CompanionDevice; onRemove: (device: CompanionDevice) => void }

/** "Last seen 5 min ago from 203.0.113.x" / "Never used". */
function lastSeenLine(d: CompanionDevice): string {
    if (d.lastUsedAt === null) return 'Never used';
    const from = d.lastUsedNetwork === null ? '' : ` from ${d.lastUsedNetwork}`;
    return `Last seen ${syncedAgo(d.lastUsedAt)}${from}`;
}

/** Inline rename: Field + Input, Save validates with the contract schema. */
function RenameForm({ device, onDone }: { device: CompanionDevice; onDone: () => void }): JSX.Element {
    const [name, setName] = useState(device.name);
    const [error, setError] = useState<string | undefined>(undefined);
    const rename = useRenameCompanionDevice();
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => { input.current?.focus(); }, []);
    const submit = (e: FormEvent): void => {
        e.preventDefault();
        const parsed = CompanionDeviceNameSchema.safeParse(name);
        if (!parsed.success) { setError(DEVICE_NAME_ERROR); return; }
        rename.mutate({ id: device.id, name: parsed.data }, {
            onSuccess: onDone,
            onError: () => setError("Couldn't rename this device. Try again."),
        });
    };
    return (
        <form onSubmit={submit} className="basis-full flex flex-wrap items-start gap-2 mt-2">
            <Field label="Device name" hideLabel error={error} className="flex-1 min-w-[12rem]">
                <Input ref={input} value={name} maxLength={64} autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </Field>
            <Button type="submit" size="sm" loading={rename.isPending} loadingLabel="Saving…">Save</Button>
            <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={rename.isPending}>Cancel</Button>
        </form>
    );
}

/** Name, chip and the two detail lines. */
function DeviceDetails({ device }: { device: CompanionDevice }): JSX.Element {
    const revoked = device.state === 'revoked';
    const token = `token …${device.tokenHint}`;
    return (
        <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium break-words ${revoked ? 'text-dim' : 'text-foreground'}`}>{device.name}</span>
                {revoked
                    ? <StatusChip tone="neutral" title="Removed — this computer can no longer upload">Removed</StatusChip>
                    : <StatusChip tone="success" title="Active — this computer can upload game data">Active</StatusChip>}
            </div>
            {revoked && device.revokedAt !== null
                ? <p className="text-xs text-dim mt-1">{`Removed ${syncedAgo(device.revokedAt)} · ${token}`}</p>
                : <>
                    <p className="text-xs text-muted mt-1">{lastSeenLine(device)}</p>
                    <p className="text-xs text-dim">{`Linked ${LINKED_FMT.format(new Date(device.createdAt))} · ${token}`}</p>
                </>}
        </div>
    );
}

/** A ref for the Rename button that takes focus back when the inline form closes. */
function useReturnFocusOnClose(open: boolean): RefObject<HTMLButtonElement | null> {
    const trigger = useRef<HTMLButtonElement>(null);
    const wasOpen = useRef(open);
    useEffect(() => {
        if (wasOpen.current && !open) trigger.current?.focus();
        wasOpen.current = open;
    }, [open]);
    return trigger;
}

/** One device row; rename expands inline under the details. */
export function CompanionDeviceRow({ device, onRemove }: RowProps): JSX.Element {
    const [renaming, setRenaming] = useState(false);
    const active = device.state === 'active';
    const renameTrigger = useReturnFocusOnClose(renaming);
    return (
        <li data-testid={`companion-device-${device.id}`} className="flex flex-wrap items-start gap-3 py-3">
            <span aria-hidden="true"
                className="w-9 h-9 shrink-0 rounded-lg bg-panel border border-edge flex items-center justify-center text-sm font-semibold text-muted">
                {OS_GLYPH[device.os]}
            </span>
            <DeviceDetails device={device} />
            {active && !renaming && (
                <div className="flex gap-2 ml-auto">
                    <Button ref={renameTrigger} variant="ghost" size="sm" onClick={() => setRenaming(true)}>Rename</Button>
                    <Button variant="destructive-soft" size="sm" onClick={() => onRemove(device)}>Remove</Button>
                </div>
            )}
            {active && renaming && <RenameForm device={device} onDone={() => setRenaming(false)} />}
        </li>
    );
}
