import { describe, it, expect } from 'vitest';
import type { PelicanConfig } from '@raid-ledger/contract';
import { buildUpdateBody, draftFromConfig, isApplicationKey, isDirty, isPelicanConfigured } from './pelican-form.helpers';

const SAVED: PelicanConfig = {
    panelUrl: 'https://panel.example.test', apiKeySet: true,
};

describe('pelican-form.helpers', () => {
    it('never prefills the key from the server', () => {
        expect(draftFromConfig(SAVED)).toEqual({
            panelUrl: 'https://panel.example.test', apiKey: '', removeKey: false,
        });
    });

    it('an untouched draft builds an empty body and is not dirty', () => {
        const draft = draftFromConfig(SAVED);
        expect(buildUpdateBody(draft, SAVED)).toEqual({});
        expect(isDirty(draft, SAVED)).toBe(false);
    });

    it('sends only changed fields, trimmed', () => {
        const draft = { ...draftFromConfig(SAVED), panelUrl: ' https://other.example.test ', apiKey: ' pacc_new ' };
        expect(buildUpdateBody(draft, SAVED)).toEqual({ panelUrl: 'https://other.example.test', apiKey: 'pacc_new' });
    });

    it('Remove sends apiKey "" and wins over a typed key', () => {
        const draft = { ...draftFromConfig(SAVED), apiKey: 'pacc_x', removeKey: true };
        expect(buildUpdateBody(draft, SAVED)).toEqual({ apiKey: '' });
    });

    it('emptying the URL sends panelUrl "" (clear)', () => {
        const draft = { ...draftFromConfig(SAVED), panelUrl: '' };
        expect(buildUpdateBody(draft, SAVED)).toEqual({ panelUrl: '' });
    });

    it('configured needs both a URL and a key (AC2)', () => {
        expect(isPelicanConfigured(SAVED)).toBe(true);
        expect(isPelicanConfigured({ ...SAVED, apiKeySet: false })).toBe(false);
        expect(isPelicanConfigured({ ...SAVED, panelUrl: null })).toBe(false);
    });

    it('flags application keys only', () => {
        expect(isApplicationKey(' papp_abc')).toBe(true);
        expect(isApplicationKey('pacc_abc')).toBe(false);
        expect(isApplicationKey('')).toBe(false);
    });
});
