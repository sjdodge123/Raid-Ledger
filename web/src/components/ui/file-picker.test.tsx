/**
 * ROK-1655 PR-1 — FilePicker (forms plan ruling 1: a primitive, no guard
 * exemption). Locks the contract the four upload sites will migrate onto:
 * the shared Button names the picker, a hidden native input[type=file] stays
 * in the DOM (existing tests upload through it), and loading/disabled close it.
 */
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FilePicker } from './file-picker';

function png(name = 'logo.png'): File {
    return new File(['x'], name, { type: 'image/png' });
}

function fileInput(container: HTMLElement): HTMLInputElement {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('FilePicker rendered no input[type="file"]');
    return input;
}

describe('FilePicker', () => {
    it('is a button named by its label', () => {
        render(<FilePicker onFiles={vi.fn()}>Upload logo</FilePicker>);
        expect(screen.getByRole('button', { name: 'Upload logo' })).toHaveAttribute('type', 'button');
    });

    it('clicking the button opens the hidden input', async () => {
        const { container } = render(<FilePicker onFiles={vi.fn()}>Upload logo</FilePicker>);
        const input = fileInput(container);
        const click = vi.spyOn(input, 'click');
        await userEvent.click(screen.getByRole('button', { name: 'Upload logo' }));
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('keeps the native input hidden and out of the tab order', () => {
        const { container } = render(<FilePicker onFiles={vi.fn()}>Upload logo</FilePicker>);
        const input = fileInput(container);
        expect(input).toHaveClass('hidden');
        expect(input).toHaveAttribute('tabindex', '-1');
    });

    it('hands the picked files to onFiles as a File[]', async () => {
        const onFiles = vi.fn();
        const { container } = render(<FilePicker onFiles={onFiles}>Upload logo</FilePicker>);
        const file = png();
        await userEvent.upload(fileInput(container), file);
        expect(onFiles).toHaveBeenCalledTimes(1);
        const arg = onFiles.mock.calls[0][0] as unknown;
        expect(Array.isArray(arg)).toBe(true);
        expect(arg).toEqual([file]);
    });

    it('forwards accept and multiple to the native input', async () => {
        const onFiles = vi.fn();
        const { container } = render(
            <FilePicker onFiles={onFiles} accept="image/png,image/jpeg" multiple>Add screenshots</FilePicker>,
        );
        const input = fileInput(container);
        expect(input).toHaveAttribute('accept', 'image/png,image/jpeg');
        expect(input.multiple).toBe(true);
        const files = [png('a.png'), png('b.png')];
        await userEvent.upload(input, files);
        expect(onFiles).toHaveBeenCalledWith(files);
    });

    it('fires again when the same file is picked twice', async () => {
        const onFiles = vi.fn();
        const { container } = render(<FilePicker onFiles={onFiles}>Upload logo</FilePicker>);
        const input = fileInput(container);
        const file = png();
        await userEvent.upload(input, file);
        await userEvent.upload(input, file);
        expect(onFiles).toHaveBeenCalledTimes(2);
    });

    it('while loading the button is busy and the click never reaches the input', async () => {
        const { container } = render(
            <FilePicker onFiles={vi.fn()} loading loadingLabel="Uploading…">Upload logo</FilePicker>,
        );
        const input = fileInput(container);
        const click = vi.spyOn(input, 'click');
        const btn = screen.getByRole('button', { name: 'Uploading…' });
        expect(btn).toHaveAttribute('aria-busy', 'true');
        await userEvent.click(btn);
        expect(click).not.toHaveBeenCalled();
        expect(input).toBeDisabled();
    });

    it('disabled disables both the button and the input', async () => {
        const onFiles = vi.fn();
        const { container } = render(<FilePicker onFiles={onFiles} disabled>Upload logo</FilePicker>);
        const input = fileInput(container);
        expect(screen.getByRole('button', { name: 'Upload logo' })).toBeDisabled();
        expect(input).toBeDisabled();
        await userEvent.upload(input, png());
        expect(onFiles).not.toHaveBeenCalled();
    });

    it('defaults to the secondary variant and takes variant/size overrides', () => {
        const { rerender } = render(<FilePicker onFiles={vi.fn()}>Upload logo</FilePicker>);
        expect(screen.getByRole('button', { name: 'Upload logo' })).toHaveClass('bg-panel');
        rerender(<FilePicker onFiles={vi.fn()} variant="ghost" size="sm">Upload logo</FilePicker>);
        expect(screen.getByRole('button', { name: 'Upload logo' })).toHaveClass('text-muted', 'px-3');
    });

    it('passes inputProps (data-testid) through to the native input', () => {
        render(<FilePicker onFiles={vi.fn()} inputProps={{ 'data-testid': 'logo-file' }}>Upload logo</FilePicker>);
        expect(screen.getByTestId('logo-file')).toHaveAttribute('type', 'file');
    });
});
