/** ROK-1836 D7 — a file icon's load failure belongs to that icon, not to the tile. */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ItemIcon } from './item-icon';
import type { ResolvedItem } from './item-icon.helpers';
import type { ItemIconContext } from './use-item-icons';

vi.mock('../hooks/use-valheim-characters', () => ({
    useValheimBlobUrl: (serverId: number, sha: string | null) =>
        sha === null ? null : `blob:${serverId}/${sha}`,
}));

const ctx: ItemIconContext = {
    serverId: 7,
    items: {},
    atlas: null,
    atlasUrl: null,
};

const fileItem = (sha256: string): ResolvedItem => ({
    label: 'Bronze Axe',
    category: null,
    kind: 'icon',
    icon: { kind: 'file', sha256 },
});

describe('ItemIcon file face', () => {
    it('draws a replacement image after the previous one failed to load', () => {
        const { rerender } = render(
            <ItemIcon
                resolved={fileItem('a'.repeat(64))}
                prefab="AxeBronze"
                ctx={ctx}
            />,
        );
        fireEvent.error(screen.getByRole('img', { name: 'Bronze Axe' }));
        expect(screen.queryByRole('img')).toBeNull();
        rerender(
            <ItemIcon
                resolved={fileItem('b'.repeat(64))}
                prefab="AxeBronze"
                ctx={ctx}
            />,
        );
        expect(screen.getByRole('img', { name: 'Bronze Axe' })).toHaveAttribute(
            'src',
            `blob:7/${'b'.repeat(64)}`,
        );
    });
});
