/**
 * ROK-2367 — every plugin page that `lazy-routes.ts` loads with
 * `import('./plugins/…')` must be mounted in `app-routes.tsx` only under a
 * `PluginRoute` (ROK-2358), so a deactivated plugin's page never renders or
 * fires its queries. A deliberate exception goes in ALLOWED_UNWRAPPED with a
 * reason; that list may only shrink (a listed page that is now wrapped, or
 * gone, fails here too).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_DIR = `${resolve(__dirname, '../..')}/`;

/** Lazy export name → why it may mount outside a PluginRoute. */
const ALLOWED_UNWRAPPED: Readonly<Record<string, string>> = {};

function parse(file: string): ts.SourceFile {
    const text = readFileSync(`${SRC_DIR}${file}`, 'utf8');
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
    visit(node);
    node.forEachChild((child) => walk(child, visit));
}

/** Each `import('./plugins/…')` in lazy-routes.ts → the exported const that holds it. */
function pluginLazyExports(): { name: string; specifier: string }[] {
    const found: { name: string; specifier: string }[] = [];
    walk(parse('lazy-routes.ts'), (n) => {
        if (!ts.isCallExpression(n) || n.expression.kind !== ts.SyntaxKind.ImportKeyword) return;
        const arg = n.arguments[0];
        if (!arg || !ts.isStringLiteral(arg) || !arg.text.startsWith('./plugins/')) return;
        let decl: ts.Node | undefined = n.parent;
        while (decl && !ts.isVariableStatement(decl)) decl = decl.parent;
        const exported = decl && ts.isVariableStatement(decl)
            && decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        const binding = decl && ts.isVariableStatement(decl) ? decl.declarationList.declarations[0]?.name : undefined;
        const name = binding && ts.isIdentifier(binding) ? binding.text : '?';
        // An indirect loader (`const load = () => import(...)`) hides which page it feeds: fail loudly.
        found.push({ name: exported ? name : `<unexported loader ${name}>`, specifier: arg.text });
    });
    return found;
}

/** `<Name …>` usages in app-routes.tsx with no enclosing `<PluginRoute>` element. */
function routeUsages(names: ReadonlySet<string>): { wrapped: Set<string>; unwrapped: string[] } {
    const sf = parse('app-routes.tsx');
    const wrapped = new Set<string>();
    const unwrapped: string[] = [];
    walk(sf, (n) => {
        if (!ts.isJsxSelfClosingElement(n) && !ts.isJsxOpeningElement(n)) return;
        const tag = n.tagName.getText(sf);
        if (!names.has(tag)) return;
        let p: ts.Node | undefined = n.parent;
        while (p && !(ts.isJsxElement(p) && p.openingElement.tagName.getText(sf) === 'PluginRoute')) p = p.parent;
        if (p) wrapped.add(tag);
        else unwrapped.push(`${tag} (app-routes.tsx:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1})`);
    });
    return { wrapped, unwrapped };
}

describe('plugin pages on core lazy routes sit under PluginRoute (ROK-2367)', () => {
    const lazy = pluginLazyExports();
    const names = new Set(lazy.map((l) => l.name));
    const { wrapped, unwrapped } = routeUsages(names);

    it('finds the plugin imports, each held by an exported lazy component', () => {
        expect(lazy.length).toBeGreaterThan(0);
        expect(lazy.filter((l) => l.name.startsWith('<')).map((l) => `${l.name} → ${l.specifier}`)).toEqual([]);
    });

    it('mounts every plugin lazy page only under a PluginRoute (or lists it with a reason)', () => {
        const offenders = unwrapped.filter((u) => !Object.hasOwn(ALLOWED_UNWRAPPED, u.split(' ')[0] ?? ''));
        expect(offenders).toEqual([]);
    });

    it('mounts every plugin lazy page somewhere in app-routes.tsx', () => {
        const unmounted = [...names].filter((n) => !wrapped.has(n) && !unwrapped.some((u) => u.startsWith(`${n} `)));
        expect(unmounted).toEqual([]);
    });

    it('keeps ALLOWED_UNWRAPPED shrink-only: every entry is still a plugin page mounted unwrapped', () => {
        const stale = Object.keys(ALLOWED_UNWRAPPED).filter((n) => !unwrapped.some((u) => u.startsWith(`${n} `)));
        expect(stale).toEqual([]);
    });
});
