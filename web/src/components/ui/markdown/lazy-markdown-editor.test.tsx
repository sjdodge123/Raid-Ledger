/** V11 (ROK-1868 D21) — loading frame while pending; Textarea fallback when the chunk fails. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

describe('LazyMarkdownEditor (V11)', () => {
    it('shows an aria-busy frame while the chunk is pending', async () => {
        vi.resetModules();
        vi.doMock('./markdown-editor', () => new Promise(() => undefined));
        const { LazyMarkdownEditor } = await import('./lazy-markdown-editor');
        render(<LazyMarkdownEditor value="" onChange={vi.fn()} maxLength={4000} />);
        expect(screen.getByTestId('md-editor-loading')).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByText('Loading editor')).toBeInTheDocument();
        vi.doUnmock('./markdown-editor');
    });

    it('falls back to a Textarea with the same value and onChange when the import rejects', async () => {
        vi.resetModules();
        vi.doMock('./markdown-editor', () => { throw new Error('chunk 404'); });
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const { LazyMarkdownEditor } = await import('./lazy-markdown-editor');
        const onChange = vi.fn();
        render(<LazyMarkdownEditor value="**hi**" onChange={onChange} maxLength={4000} testId="ed" />);
        const box = await screen.findByRole('textbox');
        expect(box.tagName).toBe('TEXTAREA');
        expect(box).toHaveValue('**hi**');
        fireEvent.change(box, { target: { value: '**hi** there' } });
        expect(onChange).toHaveBeenCalledWith('**hi** there');
        vi.doUnmock('./markdown-editor');
    });
});
