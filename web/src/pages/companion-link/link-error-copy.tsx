/** ROK-1955 — the inline error copy for a failed preview / decision. */
import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import type { CompanionLinkErrorKind } from '../../hooks/use-companion-link';
import { LINK_ERROR_COPY, MANAGE_DEVICES_HREF } from './link-copy';

/** A decision error as an alert; the device-limit case links to the Devices list. */
export function LinkErrorAlert({ kind }: { kind: CompanionLinkErrorKind }): JSX.Element {
    return (
        <p role="alert" className="mt-3 text-sm text-danger">
            {LINK_ERROR_COPY[kind]}
            {kind === 'device_limit' && (
                <> <Link to={MANAGE_DEVICES_HREF} className="underline hover:text-foreground">Manage devices</Link></>
            )}
        </p>
    );
}
