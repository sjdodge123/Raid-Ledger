/** ROK-1836 D6/D7 — the face of an item tile: sprite, file icon, initials or prefab id. */
import { useState, type JSX } from 'react';
import type { ValheimCatalogIcon } from '@raid-ledger/contract';
import {
    itemInitials,
    spriteGeometry,
    type ResolvedItem,
} from './item-icon.helpers';
import { useValheimBlobUrl } from '../hooks/use-valheim-characters';
import type { ItemIconContext } from './use-item-icons';

const ICON_BOX = 32;

function InitialsFace({ label }: { label: string }): JSX.Element {
    return (
        <span
            aria-hidden="true"
            data-face="initials"
            className="text-[13px] font-bold tracking-wide text-secondary"
        >
            {itemInitials(label)}
        </span>
    );
}

function PrefabFace({ prefab }: { prefab: string }): JSX.Element {
    return (
        <span
            aria-hidden="true"
            data-face="prefab"
            className="break-all p-0.5 text-center font-mono text-[8.5px] font-semibold leading-tight text-muted"
        >
            {prefab}
        </span>
    );
}

function AtlasFace({
    icon,
    label,
    ctx,
}: {
    icon: Extract<ValheimCatalogIcon, { kind: 'atlas' }>;
    label: string;
    ctx: ItemIconContext;
}): JSX.Element {
    if (ctx.atlas === null || ctx.atlasUrl === null)
        return <InitialsFace label={label} />;
    const g = spriteGeometry(icon, ctx.atlas, ICON_BOX);
    return (
        <span
            role="img"
            aria-label={label}
            data-face="sprite"
            className="block bg-no-repeat"
            style={{
                width: g.width,
                height: g.height,
                backgroundImage: `url("${ctx.atlasUrl}")`,
                backgroundPosition: g.backgroundPosition,
                backgroundSize: g.backgroundSize,
            }}
        />
    );
}

function FileFace({
    sha256,
    label,
    ctx,
}: {
    sha256: string;
    label: string;
    ctx: ItemIconContext;
}): JSX.Element {
    const url = useValheimBlobUrl(ctx.serverId, sha256);
    const [failed, setFailed] = useState(false);
    if (url === null || failed) return <InitialsFace label={label} />;
    return (
        <img
            src={url}
            alt={label}
            data-face="file"
            width={ICON_BOX}
            height={ICON_BOX}
            className="h-8 w-8 object-contain"
            onError={() => setFailed(true)}
        />
    );
}

/** Never throws: anything that cannot be drawn falls back down the D7 ladder. */
export function ItemIcon({
    resolved,
    prefab,
    ctx,
}: {
    resolved: ResolvedItem;
    prefab: string;
    ctx: ItemIconContext;
}): JSX.Element {
    if (resolved.kind === 'unknown') return <PrefabFace prefab={prefab} />;
    const icon = resolved.icon;
    if (icon === null) return <InitialsFace label={resolved.label} />;
    if (icon.kind === 'file')
        return (
            // Keyed by identity: a load failure belongs to that image, not the tile.
            <FileFace
                key={`${ctx.serverId}:${icon.sha256}`}
                sha256={icon.sha256}
                label={resolved.label}
                ctx={ctx}
            />
        );
    return <AtlasFace icon={icon} label={resolved.label} ctx={ctx} />;
}
