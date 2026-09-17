import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Token guard for the away panel (ROK-1585 AC5/AC9): the legacy absence UI
 * painted red fills and unremapped reds. Comments are stripped FIRST so this
 * file's own explanation (and any JSDoc naming the banned classes) can't trip it.
 */
const DIR = resolve(__dirname, '..');
const BANNED = /red-600|red-500|red-300|bg-red-|#[0-9a-fA-F]{3,8}\b/;

const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('away/*.tsx tokens', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.tsx'));

    it('finds the away components', () => {
        expect(files.length).toBeGreaterThanOrEqual(4);
    });

    it.each(files)('%s uses no banned reds or raw hex', (file) => {
        const code = stripComments(readFileSync(resolve(DIR, file), 'utf8'));
        expect(code.match(BANNED)?.[0] ?? null).toBeNull();
    });
});
