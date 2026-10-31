import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntentsFieldset } from './intents-fieldset';

const APP_ID = '1290017734588641280';
const box = (name: string) => screen.getByRole('checkbox', { name });

describe('IntentsFieldset (ROK-1703 AC-5)', () => {
    it('the ticks follow a detection result that arrives after mount', () => {
        const { rerender } = render(<IntentsFieldset appId={APP_ID} missing={undefined} />);
        expect(box('Message Content Intent')).not.toBeChecked();
        rerender(<IntentsFieldset appId={APP_ID} missing={['messageContent']} />);
        expect(box('Presence Intent')).toBeChecked();
        expect(box('Server Members Intent')).toBeChecked();
        expect(box('Message Content Intent')).not.toBeChecked();
        rerender(<IntentsFieldset appId={APP_ID} missing={[]} />);
        expect(box('Message Content Intent')).toBeChecked();
    });

    it('the owner can toggle a box; a new detection result replaces the toggle', () => {
        const { rerender } = render(<IntentsFieldset appId={APP_ID} missing={['presence']} />);
        fireEvent.click(box('Presence Intent'));
        expect(box('Presence Intent')).toBeChecked();
        rerender(<IntentsFieldset appId={APP_ID} missing={['presence', 'guildMembers']} />);
        expect(box('Presence Intent')).not.toBeChecked();
        expect(box('Server Members Intent')).not.toBeChecked();
    });
});
