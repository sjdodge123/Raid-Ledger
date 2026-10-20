import { describe, expect, it } from 'vitest';
import type {
    ValheimCharacterMapRef,
    ValheimCharacterSummary,
} from '@raid-ledger/contract';
import { pickCharacterId, pickMapId, worldLabel } from './map-selection';

function row(
    id: number,
    name: string,
    ownerId: number | null = null,
): ValheimCharacterSummary {
    return {
        id,
        pelicanServerId: 1,
        serverName: 'Fixtureheim',
        name,
        worldName: 'Fixtureheim',
        claimedBy:
            ownerId === null ? null : { id: ownerId, username: `u${ownerId}` },
        claimSource: ownerId === null ? null : 'manual',
        capturedAt: '2026-10-19T12:00:00.000Z',
        gameVersion: '0.220.5',
    };
}
const ROWS = [row(1, 'ulfgar', 7), row(2, 'Bjorn'), row(3, 'astrid')];
const map = (
    id: number,
    capturedAt: string,
    worldUid = '1234567890',
): ValheimCharacterMapRef => ({ id, worldUid, capturedAt });

describe('pickCharacterId (ROK-1837 D2)', () => {
    it('honours a listed ?vc', () => {
        expect(pickCharacterId(ROWS, '2', 7)).toBe(2);
    });
    it("defaults to the viewer's claimed character", () => {
        expect(pickCharacterId(ROWS, null, 7)).toBe(1);
    });
    it('falls back to the first by name (case-insensitive) when the viewer has none or ?vc is unknown', () => {
        expect(pickCharacterId(ROWS, '99', 42)).toBe(3);
        expect(pickCharacterId(ROWS, 'abc', null)).toBe(3);
    });
    it('is null for an empty server', () => {
        expect(pickCharacterId([], '1', 7)).toBeNull();
    });
});

describe('pickMapId', () => {
    const maps = [
        map(10, '2026-10-01T00:00:00.000Z'),
        map(11, '2026-10-18T00:00:00.000Z'),
    ];
    it('honours a listed ?vm, else the latest captured', () => {
        expect(pickMapId(maps, '10')).toBe(10);
        expect(pickMapId(maps, '12')).toBe(11);
        expect(pickMapId([], null)).toBeNull();
    });
    it('labels a world by the last four digits of its uid', () => {
        expect(worldLabel(map(1, '2026-10-01T00:00:00.000Z', '998877'))).toBe(
            'World 8877',
        );
    });
});
