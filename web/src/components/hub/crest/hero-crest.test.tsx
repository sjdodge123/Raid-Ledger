/** ROK-2074 — the hero crest: the picture opens the Gallery viewer for everyone; the pencil alone changes it. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import type { GuildCrest } from '@raid-ledger/contract';
import { renderWithProviders } from '../../../test/render-helpers';
import { useHubGalleryStore } from '../gallery/hub-gallery-store';
import { HeroCrest } from './hero-crest';
import { crestAssetUrl } from './hub-crest.helpers';

vi.mock('./crest-picker-lazy', () => ({ LazyCrestPicker: () => <div data-testid="crest-picker-stub" /> }));

const UPLOAD: GuildCrest = { source: 'upload', urlSm: '/uploads/guild-crests/7-sm.webp', urlLg: '/uploads/guild-crests/7-lg.webp' };
const PRESET: GuildCrest = { source: 'preset', emblemId: 'crown', fg: 'or', bg: 'sable' };

function renderCrest(crest: GuildCrest | null, opts: { crestMediaId?: number | null; canEdit?: boolean } = {}): void {
    renderWithProviders(
        <HeroCrest guildId={7} name="Iron Vanguard" crest={crest} crestMediaId={opts.crestMediaId ?? null}
            canEdit={opts.canEdit ?? false} className="col-start-1 row-start-1" />,
    );
}

const request = () => useHubGalleryStore.getState().request;

afterEach(() => { useHubGalleryStore.setState({ filters: {}, request: null }); });

describe('HeroCrest — view vs change (ROK-2074)', () => {
    it('a crest picked from the Gallery opens that picture in the viewer, focus returning to the crest', () => {
        renderCrest(UPLOAD, { crestMediaId: 42 });
        const view = screen.getByRole('button', { name: 'View hub picture' });
        fireEvent.click(view);
        expect(request()).toMatchObject({ guildId: 7, mode: 'viewer', mediaId: 42, returnFocus: view });
        expect(request()?.single).toBeUndefined();
    });

    it('an uploaded crest with no Gallery picture opens its large image as a single picture', () => {
        renderCrest(UPLOAD);
        fireEvent.click(screen.getByRole('button', { name: 'View hub picture' }));
        expect(request()?.mediaId).toBeUndefined();
        expect(request()?.single).toEqual({ url: crestAssetUrl(UPLOAD.source === 'upload' ? UPLOAD.urlLg : ''), alt: 'Iron Vanguard crest' });
    });

    it('a preset crest (no image) is not a button, and a non-editor gets no pencil', () => {
        renderCrest(PRESET);
        expect(screen.queryByRole('button')).toBeNull();
        expect(screen.getByTestId('hub-crest')).toHaveClass('col-start-1', 'row-start-1');
    });

    it('a non-editor viewing an upload gets the picture but no "Change crest"', () => {
        renderCrest(UPLOAD, { crestMediaId: 42 });
        expect(screen.getByRole('button', { name: 'View hub picture' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Change crest' })).toBeNull();
    });

    it('for an editor the pencil is the only "Change crest" target: it opens the picker, never the viewer', () => {
        renderCrest(UPLOAD, { crestMediaId: 42, canEdit: true });
        expect(screen.getAllByRole('button', { name: 'Change crest' })).toHaveLength(1);
        fireEvent.click(screen.getByRole('button', { name: 'Change crest' }));
        expect(screen.getByTestId('crest-picker-stub')).toBeInTheDocument();
        expect(request()).toBeNull();
        expect(screen.getByRole('button', { name: 'View hub picture' })).not.toContainElement(screen.getByTestId('hub-crest-edit'));
    });

    it('an editor on a preset crest gets the pencil but no picture button', () => {
        renderCrest(PRESET, { canEdit: true });
        expect(screen.queryByRole('button', { name: 'View hub picture' })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Change crest' }));
        expect(screen.getByTestId('crest-picker-stub')).toBeInTheDocument();
    });
});
