import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AvatarUploadZone } from './AvatarUploadZone';

const defaultProps = {
    onFileSelected: vi.fn(),
    isUploading: false,
    uploadProgress: 0,
    currentCustomUrl: null,
    onRemove: vi.fn(),
};

describe('AvatarUploadZone — part 1', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Upload progress display', () => {
        it('shows upload progress percentage when uploading', () => {
            render(<AvatarUploadZone {...defaultProps} isUploading={true} uploadProgress={75} />);
            expect(screen.getByText('75%')).toBeInTheDocument();
        });

        it('does not show progress overlay when not uploading', () => {
            render(<AvatarUploadZone {...defaultProps} isUploading={false} />);
            expect(screen.queryByText('%')).not.toBeInTheDocument();
        });
    });

    describe('Remove button behavior', () => {
        it('shows remove button when currentCustomUrl is set and not uploading', () => {
            render(
                <AvatarUploadZone
                    {...defaultProps}
                    currentCustomUrl="https://example.com/avatar.png"
                    isUploading={false}
                />
            );
            expect(screen.getByText('Remove custom avatar')).toBeInTheDocument();
        });

        it('does not show remove button when currentCustomUrl is null', () => {
            render(<AvatarUploadZone {...defaultProps} currentCustomUrl={null} />);
            expect(screen.queryByText('Remove custom avatar')).not.toBeInTheDocument();
        });

        it('does not show remove button while uploading', () => {
            render(
                <AvatarUploadZone
                    {...defaultProps}
                    currentCustomUrl="https://example.com/avatar.png"
                    isUploading={true}
                />
            );
            expect(screen.queryByText('Remove custom avatar')).not.toBeInTheDocument();
        });

        it('calls onRemove when remove button is clicked', () => {
            const onRemove = vi.fn();
            render(
                <AvatarUploadZone
                    {...defaultProps}
                    currentCustomUrl="https://example.com/avatar.png"
                    onRemove={onRemove}
                />
            );
            fireEvent.click(screen.getByText('Remove custom avatar'));
            expect(onRemove).toHaveBeenCalledOnce();
        });
    });

});

describe('AvatarUploadZone — part 2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('File validation', () => {
        it('shows error for invalid file type', () => {
            render(<AvatarUploadZone {...defaultProps} />);
            const input = document.querySelector('input[type="file"]') as HTMLInputElement;
            const file = new File(['content'], 'test.txt', { type: 'text/plain' });
            fireEvent.change(input, { target: { files: [file] } });
            expect(screen.getByText('Invalid file type. Use PNG, JPEG, WebP, or GIF.')).toBeInTheDocument();
        });

        it('shows error for file exceeding 5MB', () => {
            render(<AvatarUploadZone {...defaultProps} />);
            const input = document.querySelector('input[type="file"]') as HTMLInputElement;
            const largeContent = new Uint8Array(6 * 1024 * 1024);
            const file = new File([largeContent], 'large.png', { type: 'image/png' });
            Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 });
            fireEvent.change(input, { target: { files: [file] } });
            expect(screen.getByText('File too large. Maximum size is 5MB.')).toBeInTheDocument();
        });

        it('calls onFileSelected for valid PNG file', () => {
            // Mock URL.createObjectURL
            const mockUrl = 'blob:mock-url';
            vi.stubGlobal('URL', { createObjectURL: vi.fn(() => mockUrl) });

            const onFileSelected = vi.fn();
            render(<AvatarUploadZone {...defaultProps} onFileSelected={onFileSelected} />);
            const input = document.querySelector('input[type="file"]') as HTMLInputElement;
            const file = new File(['content'], 'avatar.png', { type: 'image/png' });
            fireEvent.change(input, { target: { files: [file] } });
            expect(onFileSelected).toHaveBeenCalledWith(file);
        });
    });

    describe('Drop zone interaction', () => {
        it('shows drop text when dragging over the zone', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            const dropZone = container.querySelector('[class*="border-dashed"]') as Element;
            fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
            expect(screen.getByText('Drop image here')).toBeInTheDocument();
        });

        it('shows default text when not dragging', () => {
            render(<AvatarUploadZone {...defaultProps} />);
            expect(screen.getByText('Click or drag to upload')).toBeInTheDocument();
        });

        it('renders file size limit text', () => {
            render(<AvatarUploadZone {...defaultProps} />);
            expect(screen.getByText('PNG, JPEG, WebP, or GIF. Max 5MB.')).toBeInTheDocument();
        });
    });

});

describe('AvatarUploadZone — part 3', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Label and accessibility', () => {
        it('names the file-picker trigger "Upload Custom Avatar" and drops the orphan <label>', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            expect(screen.queryByRole('button', { name: 'Upload Custom Avatar' }),
                'the caption should be the FilePicker trigger Button').not.toBeNull();
            expect(container.querySelector('label'), 'no <label> without a control should remain').toBeNull();
        });

        it('has file input with correct accept attribute', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            const input = container.querySelector('input[type="file"]');
            expect(input).toBeInTheDocument();
            expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
        });
    });

});

describe('AvatarUploadZone — ROK-1648 form primitives', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('the trigger and the drop zone open the same native file input, once per click', () => {
        const { container } = render(<AvatarUploadZone {...defaultProps} />);
        const input = container.querySelector('input[type="file"]') as HTMLInputElement;
        const click = vi.spyOn(input, 'click').mockImplementation(() => undefined);
        const trigger = screen.queryByRole('button', { name: 'Upload Custom Avatar' });
        expect(trigger, 'the Upload Custom Avatar trigger should be a Button').not.toBeNull();
        fireEvent.click(trigger as HTMLElement);
        expect(click, 'the trigger should open the picker exactly once (not nested in the drop zone)').toHaveBeenCalledTimes(1);
        fireEvent.click(container.querySelector('[class*="border-dashed"]') as Element);
        expect(click, 'a drop-zone click should open the same input via the forwarded ref').toHaveBeenCalledTimes(2);
    });

    it('while uploading, the trigger is a loading Button and the input is closed', () => {
        const { container } = render(<AvatarUploadZone {...defaultProps} isUploading={true} uploadProgress={30} />);
        const trigger = screen.queryByRole('button', { name: 'Uploading…' });
        expect(trigger, 'the trigger should carry the Uploading… loading label').not.toBeNull();
        expect(trigger?.getAttribute('aria-busy'), 'the trigger should be aria-busy while uploading').toBe('true');
        expect(container.querySelector('input[type="file"]')).toBeDisabled();
    });

    it('renders a validation error as a danger-token alert', () => {
        render(<AvatarUploadZone {...defaultProps} />);
        const input = document.querySelector('input[type="file"]') as HTMLInputElement;
        fireEvent.change(input, { target: { files: [new File(['x'], 'a.txt', { type: 'text/plain' })] } });
        const alert = screen.queryByRole('alert');
        expect(alert, 'the validation error should render as role=alert').not.toBeNull();
        expect(alert).toHaveTextContent('Invalid file type. Use PNG, JPEG, WebP, or GIF.');
        expect(alert?.className, 'the error should use the danger token').toContain('text-danger');
    });

    it('Remove custom avatar is a destructive-soft Button', () => {
        render(<AvatarUploadZone {...defaultProps} currentCustomUrl="https://example.com/a.png" />);
        const remove = screen.getByRole('button', { name: 'Remove custom avatar' });
        expect(remove.className, 'Remove should wear the destructive-soft variant').toContain('bg-danger/10');
    });
});
