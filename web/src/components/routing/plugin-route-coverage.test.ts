/**
 * ROK-2367 — every plugin page that `lazy-routes.ts` loads with
 * `import('./plugins/…')` must be mounted in `app-routes.tsx` only under a
 * `PluginRoute` (ROK-2358), so a deactivated plugin's page never renders or
 * fires its queries. A deliberate exception goes in ALLOWED_UNWRAPPED with a
 * reason; that list may only shrink (a listed page that is now wrapped, or
 * gone, fails here too). The PluginRoute's `slug` must be the page's own
 * plugin: the slug its folder's `register.ts` passes to `registerPlugin`
 * (so `plugins/wow/…` → `blizzard`).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SRC_DIR = `${resolve(__dirname, '../..')}/`;
const APP_ROUTES = 'app-routes.tsx';

/** Lazy export name → why it may mount outside a PluginRoute. */
const ALLOWED_UNWRAPPED: Readonly<Record<string, string>> = {
    PublicGuildCardNotFoundPage:
        'the fallback of /p/guild/:slug: renders the not-found page while the blizzard plugin is off, by design',
};

const readSrc = (file: string): string => readFileSync(`${SRC_DIR}${file}`, 'utf8');

function parse(file: string, text: string = readSrc(file)): ts.SourceFile {
    return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
    visit(node);
    node.forEachChild((child) => walk(child, visit));
}

/**
 * The slug `plugins/<folder>/register.ts` registers (`registerPlugin('<slug>', …)`),
 * the same id `PluginRoute` checks. A missing register.ts throws; a non-literal
 * slug yields a `<…>` marker that matches no PluginRoute, so it fails loudly.
 */
function pluginSlugOfFolder(folder: string): string {
    const file = `plugins/${folder}/register.ts`;
    const sf = parse(file);
    let slug: string | undefined;
    walk(sf, (n) => {
        if (slug !== undefined || !ts.isCallExpression(n) || n.expression.getText(sf) !== 'registerPlugin') return;
        const arg = n.arguments[0];
        slug = arg && ts.isStringLiteral(arg) ? arg.text : `<non-literal registerPlugin slug in ${file}>`;
    });
    return slug ?? `<no registerPlugin call in ${file}>`;
}

interface LazyPluginPage { name: string; specifier: string; owner: string }

/** Each `import('./plugins/…')` in lazy-routes.ts → the exported const that holds it, and its plugin. */
function pluginLazyExports(): LazyPluginPage[] {
    const found: LazyPluginPage[] = [];
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
        const folder = /^\.\/plugins\/([^/]+)/.exec(arg.text)?.[1] ?? '';
        found.push({ name: exported ? name : `<unexported loader ${name}>`, specifier: arg.text, owner: pluginSlugOfFolder(folder) });
    });
    return found;
}

/**
 * The enclosing `<PluginRoute>` whose CHILDREN hold `n`, or undefined. A use inside one of
 * its attributes (`fallback={<X/>}`) does not count: a fallback renders exactly when the
 * plugin is off.
 */
function enclosingPluginRoute(n: ts.Node, sf: ts.SourceFile): ts.JsxElement | undefined {
    let attr: ts.JsxAttribute | undefined;
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) {
        if (ts.isJsxAttribute(p)) attr = p;
        if (!ts.isJsxElement(p) || p.openingElement.tagName.getText(sf) !== 'PluginRoute') continue;
        // In this PluginRoute's own props (its fallback): keep looking further out.
        if (attr?.parent.parent !== p.openingElement) return p;
    }
    return undefined;
}

/** A PluginRoute's literal `slug` attribute (`slug="x"` or `slug={'x'}`), or a `<…>` marker. */
function guardSlug(el: ts.JsxElement, sf: ts.SourceFile): string {
    for (const a of el.openingElement.attributes.properties) {
        if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== 'slug') continue;
        const init = a.initializer;
        if (init && ts.isStringLiteral(init)) return init.text;
        const expr = init && ts.isJsxExpression(init) ? init.expression : undefined;
        if (expr && ts.isStringLiteralLike(expr)) return expr.text;
    }
    return '<no literal slug>';
}

/** One `<Name …>` usage; `guard` is the enclosing PluginRoute's slug, or undefined when unwrapped. */
interface RouteUsage { tag: string; where: string; guard: string | undefined }

/** Every `<Name …>` usage of a plugin lazy page in app-routes.tsx (or in `text`, a stand-in copy). */
function routeUsages(names: ReadonlySet<string>, text?: string): RouteUsage[] {
    const sf = parse(APP_ROUTES, text);
    const usages: RouteUsage[] = [];
    walk(sf, (n) => {
        if (!ts.isJsxSelfClosingElement(n) && !ts.isJsxOpeningElement(n)) return;
        const tag = n.tagName.getText(sf);
        if (!names.has(tag)) return;
        const route = enclosingPluginRoute(n, sf);
        const where = `${tag} (${APP_ROUTES}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1})`;
        usages.push({ tag, where, guard: route ? guardSlug(route, sf) : undefined });
    });
    return usages;
}

/** Wrapped usages whose PluginRoute guards a different plugin than the one the page lives in. */
function slugMismatches(lazy: readonly LazyPluginPage[], usages: readonly RouteUsage[]): string[] {
    const owner = new Map(lazy.map((l) => [l.name, l.owner]));
    return usages
        .filter((u) => u.guard !== undefined && u.guard !== owner.get(u.tag))
        .map((u) => `${u.where} sits under <PluginRoute slug="${u.guard ?? ''}"> but its page is in plugin "${owner.get(u.tag) ?? '?'}"`);
}

describe('plugin pages on core lazy routes sit under PluginRoute (ROK-2367)', () => {
    const lazy = pluginLazyExports();
    const names = new Set(lazy.map((l) => l.name));
    const usages = routeUsages(names);
    const wrapped = new Set(usages.filter((u) => u.guard !== undefined).map((u) => u.tag));
    const unwrapped = usages.filter((u) => u.guard === undefined).map((u) => u.where);

    it('finds the plugin imports, each held by an exported lazy component', () => {
        expect(lazy.length).toBeGreaterThan(0);
        expect(lazy.filter((l) => l.name.startsWith('<')).map((l) => `${l.name} → ${l.specifier}`)).toEqual([]);
    });

    it('mounts every plugin lazy page only under a PluginRoute (or lists it with a reason)', () => {
        const offenders = unwrapped.filter((u) => !Object.hasOwn(ALLOWED_UNWRAPPED, u.split(' ')[0] ?? ''));
        expect(offenders).toEqual([]);
    });

    it('guards every wrapped plugin page with its OWN plugin slug (wow folder → blizzard)', () => {
        expect(lazy.find((l) => l.name === 'AddonErrorsPage')?.owner).toBe('blizzard');
        expect(lazy.find((l) => l.name === 'ValheimCharacterPage')?.owner).toBe('valheim');
        expect(slugMismatches(lazy, usages)).toEqual([]);
    });

    it('the slug check rejects a page guarded by another plugin (Valheim page under slug="blizzard")', () => {
        const text = readSrc(APP_ROUTES);
        const valheim = '<PluginRoute slug="valheim"><ValheimCharacterPage';
        expect(text).toContain(valheim);
        const swapped = text.replace(valheim, '<PluginRoute slug="blizzard"><ValheimCharacterPage');
        expect(slugMismatches(lazy, routeUsages(names, swapped))).toEqual([
            expect.stringMatching(/^ValheimCharacterPage \(app-routes\.tsx:\d+\) sits under <PluginRoute slug="blizzard"> but its page is in plugin "valheim"$/),
        ]);
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
