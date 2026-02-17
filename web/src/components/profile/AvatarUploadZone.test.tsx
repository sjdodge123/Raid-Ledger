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

describe('AvatarUploadZone', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('Responsive avatar preview sizing', () => {
        it('renders avatar placeholder with mobile size class w-16 h-16', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            const placeholder = container.querySelector('.w-16.h-16');
            expect(placeholder).toBeInTheDocument();
        });

        it('renders avatar placeholder with desktop size class sm:w-20 sm:h-20', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            // The placeholder div has both mobile and desktop size classes
            const placeholder = container.querySelector('.w-16.h-16.sm\\:w-20.sm\\:h-20');
            expect(placeholder).toBeInTheDocument();
        });

        it('renders preview image with responsive size classes when currentCustomUrl is provided', () => {
            const { container } = render(
                <AvatarUploadZone {...defaultProps} currentCustomUrl="https://example.com/avatar.png" />
            );
            const img = container.querySelector('img[alt="Avatar preview"]');
            expect(img).toBeInTheDocument();
            expect(img).toHaveClass('w-16');
            expect(img).toHaveClass('h-16');
            expect(img).toHaveClass('sm:w-20');
            expect(img).toHaveClass('sm:h-20');
        });

        it('renders progress SVG with responsive size classes when uploading', () => {
            const { container } = render(
                <AvatarUploadZone {...defaultProps} isUploading={true} uploadProgress={50} />
            );
            // The progress SVG has responsive classes
            const progressSvg = container.querySelector('svg.w-16.h-16.sm\\:w-20.sm\\:h-20');
            expect(progressSvg).toBeInTheDocument();
        });
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

    describe('Label and accessibility', () => {
        it('renders the Upload Custom Avatar label', () => {
            render(<AvatarUploadZone {...defaultProps} />);
            expect(screen.getByText('Upload Custom Avatar')).toBeInTheDocument();
        });

        it('has hidden file input with correct accept attribute', () => {
            const { container } = render(<AvatarUploadZone {...defaultProps} />);
            const input = container.querySelector('input[type="file"]');
            expect(input).toBeInTheDocument();
            expect(input).toHaveClass('hidden');
            expect(input).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');
        });
    });
});
