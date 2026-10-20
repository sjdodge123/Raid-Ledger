/** ROK-1853 — one chest's contents as `ItemTile`s: `Modal` ≥1024px, `BottomSheet` below (§4.4). */
import type { JSX } from 'react';
import type {
    ValheimContainerDetail,
    ValheimContainerSummary,
    ValheimItemStack,
} from '@raid-ledger/contract';
import { BottomSheet } from '../../../components/ui/bottom-sheet';
import { Modal } from '../../../components/ui/modal';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { DESKTOP_MQ } from '../../../lib/breakpoints';
import { ItemTile } from '../character/item-tile';
import type { ItemIconContext } from '../character/use-item-icons';
import { useValheimContainer } from '../hooks/use-valheim-materials';
import { chestLabel, formatCoords } from './materials.helpers';

interface ChestDetailProps {
    serverId: number;
    includeVehicles: boolean;
    chest: ValheimContainerSummary | null;
    ctx: ItemIconContext;
    onClose: () => void;
}

const toItem = (
    s: ValheimContainerDetail['stacks'][number],
): ValheimItemStack => ({
    prefab: s.prefab,
    stack: Math.max(1, s.stack),
    quality: s.quality,
    variant: 0,
    durability: null,
    maxDurability: null,
});

function Contents({
    detail,
    ctx,
}: {
    detail: ValheimContainerDetail;
    ctx: ItemIconContext;
}): JSX.Element {
    // Checked first: an unreadable chest has no stacks, but it is not empty (Codex r2).
    if (detail.unreadable)
        return (
            <p
                role="status"
                className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
            >
                Raid Ledger couldn’t read this chest’s contents in the last
                scan, so what it holds is unknown.
            </p>
        );
    if (detail.stacks.length === 0)
        return <p className="text-sm text-muted">This chest is empty.</p>;
    return (
        <ul className="flex flex-wrap gap-2" aria-label="Chest contents">
            {detail.stacks.map((s, i) => (
                <li key={`${s.prefab}:${s.quality}:${i}`}>
                    <ItemTile item={toItem(s)} ctx={ctx} />
                </li>
            ))}
        </ul>
    );
}

function ChestBody({
    serverId,
    includeVehicles,
    chest,
    ctx,
}: Omit<ChestDetailProps, 'onClose'>): JSX.Element {
    const q = useValheimContainer(
        serverId,
        includeVehicles,
        chest?.key ?? null,
    );
    return (
        <div className="space-y-3" data-testid="valheim-chest-detail">
            {chest !== null && (
                <p className="text-xs text-muted tabular-nums">
                    {formatCoords(chest.x, chest.z)} · {chest.usedSlots}/
                    {chest.slots} slots
                </p>
            )}
            {q.isPending && (
                <p className="text-sm text-muted">Loading chest…</p>
            )}
            {q.isError && (
                <p
                    role="alert"
                    className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
                >
                    Couldn’t load this chest.
                </p>
            )}
            {q.data !== undefined && <Contents detail={q.data} ctx={ctx} />}
        </div>
    );
}

export function ChestDetail(props: ChestDetailProps): JSX.Element {
    const isDesktop = useMediaQuery(DESKTOP_MQ);
    const { chest, onClose, ctx } = props;
    const title = chest === null ? 'Chest' : chestLabel(chest, ctx);
    const body = <ChestBody {...props} />;
    return isDesktop ? (
        <Modal
            isOpen={chest !== null}
            onClose={onClose}
            title={title}
            maxWidth="max-w-lg"
        >
            {body}
        </Modal>
    ) : (
        <BottomSheet isOpen={chest !== null} onClose={onClose} title={title}>
            {body}
        </BottomSheet>
    );
}
