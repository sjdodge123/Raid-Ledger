/**
 * ROK-2366 — RuleTester spec for `eslint-rules/plugin-boundary.mjs`
 * (`rl-plugin-boundary/deep-import`), shared by the api and web lint configs.
 * A fake workspace under the cwd stands in for `api/` or `web/`; no file is read.
 */
import { resolve } from 'node:path';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import { createPluginBoundaryRule } from '../../../eslint-rules/plugin-boundary.mjs';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const WS = resolve(process.cwd(), '__plugin_boundary_ws__');
const at = (rel: string) => `${WS}/${rel}`;
const allowlistFile = `${WS}/plugin-boundary-allowlist.json`;

/** Web-shaped: register.ts is an entry; an `@/` alias is exercised here though web has none today. */
const webRule = createPluginBoundaryRule({
    workspaceDir: WS, allowlistFile, entries: ['index', 'register'], aliases: { '@/': `${WS}/src/` },
});
/** Api-shaped: only index.ts is an entry; plugins/plugin-host is host code, never a target. */
const apiRule = createPluginBoundaryRule({ workspaceDir: WS, allowlistFile, hostDirs: ['plugin-host'] });

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
const deep = (spec: string, slug: string) => ({ messageId: 'deep', data: { spec, slug } });
const computed = (slug: string) => ({ messageId: 'computed', data: { slug } });

tester.run('deep-import (web shape)', webRule, {
    valid: [
        { filename: at('src/components/a.ts'), code: "import { x } from '../plugins/wow';" },
        { filename: at('src/components/a.ts'), code: "import { x } from '../plugins/wow/index';" },
        { filename: at('src/components/a.ts'), code: "import { x } from '../plugins/wow/index.ts';" },
        { filename: at('src/App.tsx'), code: "import './plugins/wow/register';" },
        { filename: at('src/plugins/wow/pages/p.ts'), code: "import { y } from '../lib/y';" },
        { filename: at('src/plugins/wow-common/a.ts'), code: "import { b } from './b';" },
        { filename: at('src/components/a.ts'), code: "import { c } from '../lib/c';" },
        { filename: at('src/components/a.ts'), code: "import { c } from 'react';" },
        // Documented gap: the static prefix stops short of plugins/<x>/.
        { filename: at('src/lazy-routes.ts'), code: 'const n = "wow"; import(`./plugins/${n}/page`);' },
        {
            filename: at('src/components/a.ts'),
            code: "import { z } from '../plugins/wow/lib/z';",
            options: [{ allowlist: { 'src/components/a.ts': ['../plugins/wow/lib/z'] } }],
        },
        // Outside src/: not checked.
        { filename: at('scripts/s.ts'), code: "import '../src/plugins/wow/lib/z';" },
    ],
    invalid: [
        { filename: at('src/components/a.ts'), code: "import { z } from '../plugins/wow/lib/z';", errors: [deep('../plugins/wow/lib/z', 'wow')] },
        { filename: at('src/components/a.ts'), code: "export { z } from '../plugins/wow/lib/z';", errors: [deep('../plugins/wow/lib/z', 'wow')] },
        { filename: at('src/components/a.ts'), code: "export * from '../plugins/wow/lib/z';", errors: [deep('../plugins/wow/lib/z', 'wow')] },
        { filename: at('src/lazy-routes.ts'), code: "const P = () => import('./plugins/valheim/pages/v');", errors: [deep('./plugins/valheim/pages/v', 'valheim')] },
        { filename: at('src/lazy-routes.ts'), code: 'const n = "v"; import(`./plugins/valheim/pages/${n}`);', errors: [computed('valheim')] },
        { filename: at('src/lazy-routes.ts'), code: "const n = 'v'; import('./plugins/valheim/pages/' + n);", errors: [computed('valheim')] },
        { filename: at('src/components/a.ts'), code: "import '@/plugins/wow/lib/z';", errors: [deep('@/plugins/wow/lib/z', 'wow')] },
        { filename: at('src/components/a.ts'), code: "import '../plugins/wow/sub/index';", errors: [deep('../plugins/wow/sub/index', 'wow')] },
        { filename: at('src/components/a.ts'), code: "import '../x/../plugins/wow/lib/z';", errors: [deep('../x/../plugins/wow/lib/z', 'wow')] },
        // Sibling-prefix slugs are different plugins.
        { filename: at('src/plugins/wow-common/a.ts'), code: "import '../wow/lib/x';", errors: [deep('../wow/lib/x', 'wow')] },
        { filename: at('src/plugins/wow/a.ts'), code: "import '../wow-common/x';", errors: [deep('../wow-common/x', 'wow-common')] },
        {
            filename: at('src/components/a.ts'),
            code: "import { c } from '../lib/c';",
            options: [{ allowlist: { 'src/components/a.ts': ['../plugins/wow/gone'] } }],
            errors: [{ messageId: 'stale', data: { spec: '../plugins/wow/gone', list: 'plugin-boundary-allowlist.json' } }],
        },
    ],
});

tester.run('deep-import (api shape)', apiRule, {
    valid: [
        { filename: at('src/app.module.ts'), code: "import { M } from './plugins/pelican';" },
        { filename: at('src/app.module.ts'), code: "import { H } from './plugins/plugin-host/host.service';" },
    ],
    invalid: [
        { filename: at('src/app.module.ts'), code: "import './plugins/wow/register';", errors: [deep('./plugins/wow/register', 'wow')] },
        // Host code is checked as an importer.
        { filename: at('src/plugins/plugin-host/h.ts'), code: "import '../pelican/presence';", errors: [deep('../pelican/presence', 'pelican')] },
    ],
});
