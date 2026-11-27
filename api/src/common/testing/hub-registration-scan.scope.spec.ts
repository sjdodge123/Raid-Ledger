/**
 * ROK-2365 — mutation probes for the plugin-scope guard: each fixture below
 * must go red, so the real-tree guard in
 * `plugins/plugin-host/plugin-scope.guard.spec.ts` cannot pass vacuously.
 */
import type { ScanSource } from './hub-registration-scan';
import { controllerScopeViolations } from './hub-registration-scan.scope';
import { handlerScopeViolations } from './hub-registration-scan.handlers';

const FILE = 'plugins/valheim/x.controller.ts';
const KEY = `${FILE}#XController`;

function ctl(header: string, routes: string): ScanSource[] {
  return [
    {
      file: FILE,
      text: `import { A } from 'a';\n${header}\nexport class XController {\n  constructor(private readonly s: S) {}\n\n${routes}\n}\n`,
    },
  ];
}

const GET = `  @Get('a')\n  a() {\n    return 1;\n  }\n`;
const POST = `  @Post('b')\n  b() {\n    return 2;\n  }\n`;
const GUARDED = `@Controller('x')\n@UseGuards(PluginActiveGuard)\n@RequirePlugin(VALHEIM_PLUGIN_ID)`;

describe('ROK-2365 — controller rule (each must go red)', () => {
  it('passes a class behind PluginActiveGuard + @RequirePlugin', () => {
    expect(controllerScopeViolations(ctl(GUARDED, GET + POST), {})).toEqual([]);
  });

  it('fails an unguarded controller in a plugin folder', () => {
    expect(controllerScopeViolations(ctl(`@Controller('x')`, GET), {})).toEqual(
      [
        `${KEY} is not behind @RequirePlugin + PluginActiveGuard (class or every route) and is not allowlisted`,
      ],
    );
  });

  it('fails @RequirePlugin without PluginActiveGuard (inert metadata)', () => {
    const header = `@Controller('x')\n@RequirePlugin(VALHEIM_PLUGIN_ID)`;
    expect(controllerScopeViolations(ctl(header, GET), {})).toHaveLength(1);
  });

  it('passes per-route guards, fails when one route lacks them', () => {
    const header = `@Controller('x')\n@UseGuards(PluginActiveGuard)`;
    const req = `  @RequirePlugin(VALHEIM_PLUGIN_ID)\n`;
    expect(
      controllerScopeViolations(ctl(header, req + GET + req + POST), {}),
    ).toEqual([]);
    expect(
      controllerScopeViolations(ctl(header, req + GET + POST), {}),
    ).toHaveLength(1);
  });

  it('ignores core/ and plugin-host/ controllers', () => {
    const core = ctl(`@Controller('x')`, GET).map((s) => ({
      ...s,
      file: 'plugins/core/x.controller.ts',
    }));
    expect(controllerScopeViolations(core, {})).toEqual([]);
  });

  it('fails an off-list reason, an own-guard the class lacks, and a stale entry', () => {
    const bare = ctl(`@Controller('x')`, GET);
    expect(controllerScopeViolations(bare, { [KEY]: 'because' })).toEqual([
      `${KEY}: allowlist reason "because" is not in the fixed set`,
    ]);
    expect(
      controllerScopeViolations(bare, { [KEY]: 'own-guard: FooGuard' }),
    ).toEqual([
      `${KEY}: allowlisted as own-guard FooGuard, which it does not use`,
    ]);
    expect(
      controllerScopeViolations(ctl(GUARDED, GET), { [KEY]: 'cleanup' }),
    ).toEqual([`${KEY}: allowlisted but already plugin-guarded — drop it`]);
  });

  it('accepts the core-auth reason for an unguarded sign-in controller', () => {
    const bare = ctl(`@Controller('x')`, GET);
    expect(controllerScopeViolations(bare, { [KEY]: 'core-auth' })).toEqual([]);
  });
});

const HFILE = 'plugins/valheim/x.listener.ts';

function listener(body: string, extra = ''): ScanSource[] {
  return [
    {
      file: HFILE,
      text: `export class XListener {\n  @OnEvent(SOME_EVENT)\n  async onThing(e: { id: number }): Promise<void> {\n${body}\n  }\n${extra}}\n`,
    },
  ];
}

const CHECK = `    if (!this.registry.isActive(VALHEIM_PLUGIN_ID)) return;`;

describe('ROK-2365 — handler rule (each must go red)', () => {
  it('fails an @OnEvent handler with no active check', () => {
    expect(
      handlerScopeViolations(listener('    await this.repo.write(e.id);'), {}),
    ).toEqual([
      `${HFILE}#onThing has no active check (getActiveSlugsSync / isActive) or // plugin-scope: cleanup marker and is not allowlisted`,
    ]);
  });

  it('passes an inline check, a one-level delegated check, and the cleanup marker', () => {
    const helper = `\n  private async work(): Promise<void> {\n${CHECK}\n  }\n`;
    expect(handlerScopeViolations(listener(CHECK), {})).toEqual([]);
    expect(
      handlerScopeViolations(listener('    await this.work();', helper), {}),
    ).toEqual([]);
    expect(
      handlerScopeViolations(listener('    // plugin-scope: cleanup'), {}),
    ).toEqual([]);
  });

  it('does not count a commented-out check', () => {
    const body = `    // if (!this.registry.isActive(VALHEIM_PLUGIN_ID)) return;`;
    expect(handlerScopeViolations(listener(body), {})).toHaveLength(1);
  });

  it('fails an unchecked @Processor process() and Discord interaction callback', () => {
    const text = `@Processor(Q)\nexport class P extends WorkerHost {\n  async process(job: Job): Promise<void> {\n    await this.run(job);\n  }\n  bind(): void {\n    gatewayBinding('interactionCreate', (i) => {\n      void i.reply('x');\n    });\n  }\n}\n`;
    expect(handlerScopeViolations([{ file: HFILE, text }], {})).toEqual([
      `${HFILE}#P.process has no active check (getActiveSlugsSync / isActive) or // plugin-scope: cleanup marker and is not allowlisted`,
      `${HFILE}#interactionCreate[0] has no active check (getActiveSlugsSync / isActive) or // plugin-scope: cleanup marker and is not allowlisted`,
    ]);
  });

  it('accepts a gap: reason, rejects a stale handler entry', () => {
    const key = `${HFILE}#onThing`;
    const unchecked = listener('    await this.repo.write(e.id);');
    expect(
      handlerScopeViolations(unchecked, { [key]: 'gap: writes while off' }),
    ).toEqual([]);
    expect(
      handlerScopeViolations(listener(CHECK), { [key]: 'cleanup' }),
    ).toEqual([`${key}: allowlisted but already checked — drop it`]);
  });
});
