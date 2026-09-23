import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    baselineViolations, countRawFormElements, countTree, inScope, stripComments,
} from '../../test/form-primitives-count';

/**
 * Form-primitives guard (ROK-1646).
 *
 * New UI must use the shared `components/ui` primitives (`Button`, `Input`,
 * `Select`, `Textarea`, `Checkbox`, …) instead of raw `<input>` / `<select>` /
 * `<textarea>` / `<button>`. The existing call sites are frozen in
 * `form-primitives.baseline.json` (`{path: count}`), and the list only shrinks:
 * a new file with a raw element fails, a count above its baseline fails, and a
 * count BELOW its baseline fails too ("lower baseline to N") so a migration
 * locks in its gain. Comments are stripped first, so prose can't trip it.
 */

const SRC = resolve(__dirname, '../..');
const baseline = JSON.parse(readFileSync(resolve(__dirname, 'form-primitives.baseline.json'), 'utf-8')) as Record<string, number>;

describe('form-primitives guard (ROK-1646)', () => {
    it('no raw form element outside components/ui beyond the frozen baseline', () => {
        expect(baselineViolations(countTree(SRC), baseline)).toEqual([]);
    });
});

describe('form-primitives guard — mutation tests', () => {
    const base = { 'pages/a.tsx': 2 };

    it('fails on a file that is not in the baseline', () => {
        const v = baselineViolations({ 'pages/a.tsx': 2, 'pages/new.tsx': 1 }, base);
        expect(v).toEqual([expect.stringContaining('pages/new.tsx: 1 raw form element(s) in a file not in the baseline')]);
    });

    it('fails when a count rises above its baseline', () => {
        expect(baselineViolations({ 'pages/a.tsx': 3 }, base)).toEqual([expect.stringContaining('pages/a.tsx: 3 raw form element(s), baseline 2')]);
    });

    it('fails when a count drops below its baseline, asking to lower it', () => {
        expect(baselineViolations({ 'pages/a.tsx': 1 }, base)).toEqual([expect.stringContaining('lower baseline to 1')]);
        expect(baselineViolations({}, base)).toEqual([expect.stringContaining('lower baseline to 0')]);
    });

    it('passes on an exact match', () => {
        expect(baselineViolations({ 'pages/a.tsx': 2 }, base)).toEqual([]);
    });

    it('counts all four elements and ignores look-alikes', () => {
        expect(countRawFormElements('<input /><select><textarea /><button>')).toBe(4);
        expect(countRawFormElements('<Input /><Button /><inputs /><buttonGroup />')).toBe(0);
    });

    it('ignores elements inside line, block and JSX comments', () => {
        const src = '// <input />\n/* <button> */\n{/* <select> */}\n<textarea />';
        expect(countRawFormElements(src)).toBe(1);
    });

    it('is string-literal safe: a // inside a string is not a comment', () => {
        expect(stripComments("const u = 'https://x.dev'; // gone")).toBe("const u = 'https://x.dev'; ");
        expect(countRawFormElements('<a href="http://x">x</a><input />')).toBe(1);
        expect(countRawFormElements('const t = `a // b`; <button />')).toBe(1);
    });

    it('scopes to .tsx outside components/ui and dev, excluding tests', () => {
        expect(inScope('pages/a.tsx')).toBe(true);
        expect(['components/ui/button.tsx', 'dev/x.tsx', 'pages/a.test.tsx', 'lib/a.ts'].filter(inScope)).toEqual([]);
    });
});
