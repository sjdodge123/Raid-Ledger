/**
 * ROK-1960 §5 step 1 — the drop zone is a named group whose one keyboard/AT
 * control is the FilePicker button; a click on the zone background opens the
 * same picker, and does nothing while a save is being read.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BG3_SAVES_PATH_HINT, Bg3UploadDropZone } from './bg3-upload-drop-zone';

const PROMPT = 'Drag a save folder or .lsv file here';

function renderZone(busy = false) {
    const onFiles = vi.fn();
    render(<Bg3UploadDropZone onFiles={onFiles} busy={busy} />);
    const click = vi.spyOn(screen.getByTestId('bg3-upload-input'), 'click').mockImplementation(() => undefined);
    return { onFiles, click };
}

afterEach(() => vi.restoreAllMocks());

describe('Bg3UploadDropZone accessibility', () => {
    it('is a group named by its prompt and described by the saves-path hint', () => {
        renderZone();
        const groups = screen.queryAllByRole('group', { name: PROMPT });
        expect(groups).toHaveLength(1);
        expect(groups[0]).toHaveAccessibleDescription(BG3_SAVES_PATH_HINT);
    });

    it('its one keyboard control is the "Choose a save" button; Enter opens the picker', async () => {
        const { click } = renderZone();
        const user = userEvent.setup();
        await user.tab();
        const zone = screen.getByTestId('bg3-upload-drop-zone');
        expect(within(zone).getAllByRole('button').map((b) => b.textContent)).toEqual(['Choose a save']);
        expect(document.activeElement).toBe(within(zone).getByRole('button', { name: 'Choose a save' }));
        await user.keyboard('{Enter}');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('a click on the zone background opens the same picker', () => {
        const idle = renderZone();
        fireEvent.click(screen.getByTestId('bg3-upload-drop-zone'));
        expect(idle.click).toHaveBeenCalledTimes(1);
    });

    it('a click on the zone while busy does nothing', () => {
        const { click } = renderZone(true);
        fireEvent.click(screen.getByTestId('bg3-upload-drop-zone'));
        expect(click).not.toHaveBeenCalled();
    });
});
