/**
 * ROK-1572 AC1 — one label. No LFG surface may still offer "Find a time" or
 * a bare 'Start poll' entry point; the poll starts from "Start a scheduling
 * poll". Source introspection (comments stripped first, so a historical
 * mention in a doc comment cannot trip it). The ONE allowed 'Start poll' is
 * the confirm dialog's submit (approved H4: Cancel / Start poll).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const WEB_SRC = resolve(__dirname, '../..');
const ALLOWED = /pollSubmit:\s*'Start poll'/;

function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function sweptFiles(): string[] {
    const lfg = readdirSync(resolve(WEB_SRC, 'pages/lfg'))
        .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
        .map((f) => `pages/lfg/${f}`);
    return [...lfg, 'hooks/use-lfg-actions.ts'];
}

describe('LFG poll label guard (ROK-1572 AC1)', () => {
    it.each(sweptFiles())('%s carries no retired poll label', (file) => {
        const code = stripComments(readFileSync(resolve(WEB_SRC, file), 'utf8'));
        expect(code).not.toContain('Find a time');
        expect(code.replace(ALLOWED, '')).not.toContain("'Start poll'");
    });
});
