/**
 * ROK-1814 — the crest picker stays a lazy, editor-only chunk so `hub-page`
 * keeps its bundle budget. Outside `components/hub/crest/crest-picker*`, no
 * source file may statically import `crest-picker` (only `crest-picker-lazy`
 * is allowed), and `hero-crest` must reach the picker through the lazy
 * wrapper. Comments are stripped first so a doc-comment mention cannot trip it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../../test/strip-comments';

const SRC = join(__dirname, '../../..');
const PICKER_TREE = /^components\/hub\/crest\/crest-picker[^/]*$/;
const STATIC_IMPORT = /(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;
const TYPE_ONLY = /^(?:import|export)\s+type\s/;

function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p, out);
        else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
    }
    return out;
}

function pickerImports(src: string): string[] {
    const found: string[] = [];
    for (const m of stripComments(src).matchAll(STATIC_IMPORT)) {
        const spec = m[1] ?? m[2] ?? '';
        if (/(^|\/)crest-picker$/.test(spec) && !TYPE_ONLY.test(m[0])) found.push(spec);
    }
    return found;
}

describe('lazy crest picker guard (ROK-1814)', () => {
    it('no app file outside the picker tree statically imports crest-picker', () => {
        const bad: string[] = [];
        for (const file of walk(SRC)) {
            const rel = relative(SRC, file).split('\\').join('/');
            if (PICKER_TREE.test(rel)) continue;
            for (const spec of pickerImports(readFileSync(file, 'utf8'))) bad.push(`${rel} -> ${spec}`);
        }
        expect(bad).toEqual([]);
    });

    it('hero-crest opens the picker through crest-picker-lazy', () => {
        const src = stripComments(readFileSync(join(__dirname, 'hero-crest.tsx'), 'utf8'));
        expect(src).toContain("from './crest-picker-lazy'");
    });

    it('the guard sees a real static import and skips a type-only one (self-check)', () => {
        expect(pickerImports("import { CrestPicker } from './crest-picker';")).toEqual(['./crest-picker']);
        expect(pickerImports("import type { CrestPickerProps } from './crest-picker';")).toEqual([]);
    });
});
