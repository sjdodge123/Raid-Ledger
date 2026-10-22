/**
 * V12 (ROK-1868 §3.4) — the editor stays a lazy chunk. Outside
 * `components/ui/markdown/**`, no source file may import `@tiptap/*` or import
 * `markdown-editor` statically (only `lazy-markdown-editor` is allowed).
 * Comments are stripped first so a doc-comment mention cannot trip the guard.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '../../..');
const ALLOWED_DIR = 'components/ui/markdown/';
const STATIC_IMPORT = /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
}

function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function offenders(): string[] {
    const bad: string[] = [];
    for (const file of walk(SRC)) {
        const rel = relative(SRC, file).split('\\').join('/');
        if (rel.startsWith(ALLOWED_DIR)) continue;
        for (const m of stripComments(readFileSync(file, 'utf8')).matchAll(STATIC_IMPORT)) {
            const spec = m[1] ?? m[2] ?? '';
            if (spec.startsWith('@tiptap/') || /(^|\/)markdown-editor$/.test(spec)) bad.push(`${rel} -> ${spec}`);
        }
    }
    return bad;
}

describe('lazy markdown editor guard (V12)', () => {
    it('no file outside ui/markdown statically imports @tiptap/* or markdown-editor', () => {
        expect(offenders()).toEqual([]);
    });

    it('the guard sees a real static import (self-check)', () => {
        const sample = "import { Editor } from '@tiptap/core';\nimport X from '../ui/markdown/markdown-editor';";
        const specs = [...stripComments(sample).matchAll(STATIC_IMPORT)].map((m) => m[1] ?? m[2]);
        expect(specs).toEqual(['@tiptap/core', '../ui/markdown/markdown-editor']);
    });
});
