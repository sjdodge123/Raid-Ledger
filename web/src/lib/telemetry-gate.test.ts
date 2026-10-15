import { describe, it, expect } from 'vitest';
import { shouldInitTelemetry } from './telemetry-gate';

describe('shouldInitTelemetry (ROK-1779)', () => {
    it.each([
        { server: true, buildDisabled: false, expected: true },
        { server: false, buildDisabled: false, expected: false },
        { server: undefined, buildDisabled: false, expected: false },
        { server: true, buildDisabled: true, expected: false },
        { server: false, buildDisabled: true, expected: false },
        { server: undefined, buildDisabled: true, expected: false },
    ])('server=$server buildDisabled=$buildDisabled → $expected', ({ server, buildDisabled, expected }) => {
        expect(shouldInitTelemetry(server, buildDisabled)).toBe(expected);
    });
});
