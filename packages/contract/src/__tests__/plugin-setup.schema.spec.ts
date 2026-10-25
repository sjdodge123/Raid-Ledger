/**
 * ROK-1969 §3.5 — every plugin hub manifest carries a `setup` section, and
 * each setup requirement says what is needed and where it goes.
 */
import { describe, expect, it } from 'vitest';
import { PluginHubManifestSchema } from '../plugin-hub-manifest.schema.js';
import { HUB_PLUGIN_MANIFESTS, hubManifestFor } from '../plugin-hub-manifests.js';
import {
  PluginSetupRequirementSchema,
  PluginSetupSchema,
  PluginSetupStatusSchema,
  type PluginSetupRequirement,
} from '../plugin-setup.schema.js';
import { PluginInfoSchema } from '../plugins.schema.js';

function must<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`missing ${label}`);
  return value;
}

const lists = { widgets: [], tabs: [], behaviours: [] };
const secret = {
  id: 'link-token',
  kind: 'server_secret',
  title: 'Link token',
  instructions: 'Issue a token and put it in the config file.',
  required: true,
  pelican: { files: ['BepInEx/config/RaidLedger.ValheimLink.cfg'] },
};
const messages = (input: unknown): string[] =>
  (PluginSetupRequirementSchema.safeParse(input).error?.issues ?? []).map(
    (i) => `${i.path.join('.')}: ${i.message}`,
  );
const setupIds = (slug: string): string[] =>
  must(hubManifestFor(slug), slug).setup.requirements.map((r) => r.id);

describe('PluginHubManifestSchema setup (§3.5)', () => {
  it('rejects a manifest without a setup section', () => {
    const result = PluginHubManifestSchema.safeParse(lists);
    expect(result.error?.issues.map((i) => i.path.join('.'))).toEqual(['setup']);
  });

  it('accepts an explicit empty requirement list', () => {
    const parsed = PluginHubManifestSchema.parse({ ...lists, setup: { requirements: [] } });
    expect(parsed.setup.requirements).toEqual([]);
  });

  it('rejects two requirements with the same id in one plugin', () => {
    const result = PluginSetupSchema.safeParse({ requirements: [secret, secret] });
    expect(result.error?.issues.map((i) => i.message)).toEqual([
      'Duplicate setup requirement id "link-token"',
    ]);
  });
});

describe('PluginSetupRequirementSchema (§3.5)', () => {
  it('accepts a server secret that says where it goes', () => {
    expect(messages(secret)).toEqual([]);
  });

  it('rejects a server secret without instructions', () => {
    const { instructions: _omit, ...noInstructions } = secret;
    expect(messages(noInstructions)).toEqual(['instructions: Setup instructions are required']);
    expect(messages({ ...secret, instructions: '   ' })).toEqual([
      'instructions: Setup instructions are required',
    ]);
  });

  it('rejects a server secret that does not name a Pelican variable or file', () => {
    const { pelican: _omit, ...nowhere } = secret;
    expect(messages(nowhere)).toEqual([
      'pelican: A server_secret must name where it goes (pelican.variable or pelican.files)',
    ]);
  });

  it('rejects a check id that is not <plugin>.<name>', () => {
    expect(messages({ ...secret, check: 'heartbeat' })).toEqual([
      'check: A check id is <plugin>.<name>',
    ]);
  });

  it('rejects a non-https link', () => {
    const links = [{ label: 'Repo', url: 'http://example.com' }];
    expect(messages({ ...secret, links })).toEqual(['links.0.url: Links must be https']);
  });
});

describe('declared setup (§3.5)', () => {
  it('Core needs nothing', () => {
    expect(HUB_PLUGIN_MANIFESTS.core.setup.requirements).toEqual([]);
  });

  it('declares the real setup each plugin needs on main', () => {
    expect(setupIds('valheim')).toEqual([
      'pelican-server', 'link-mod', 'link-token', 'item-catalogue-admin', 'player-steam-link',
    ]);
    expect(setupIds('pelican')).toEqual(['panel-connection', 'server-hub']);
    expect(setupIds('blizzard')).toEqual(['battle-net-api', 'ledgerlink-addon']);
  });

  it('never ships a secret value: every server secret points at a place, not a value', () => {
    const all = Object.values(HUB_PLUGIN_MANIFESTS).flatMap(
      (m): readonly PluginSetupRequirement[] => m.setup.requirements,
    );
    const text = JSON.stringify(all);
    expect(text).not.toMatch(/ptl[ac]_|pacc_|rlvl_|Bearer [A-Za-z0-9]/);
  });
});

describe('PluginInfo setup status (§3.5, L2)', () => {
  it('defaults setupStatus to an empty list for an older payload', () => {
    const legacy = {
      slug: 'valheim', name: 'Valheim', version: '1.0.0', description: 'x',
      author: { name: 'Raid Ledger' }, capabilities: [], integrations: [],
      status: 'active', installedAt: null,
    };
    expect(PluginInfoSchema.parse(legacy).setupStatus).toEqual([]);
  });

  it('accepts met / unmet / unknown and nothing else', () => {
    expect(PluginSetupStatusSchema.safeParse({ id: 'link-token', state: 'met' }).success).toBe(true);
    expect(PluginSetupStatusSchema.safeParse({ id: 'link-token', state: 'done' }).success).toBe(false);
  });
});
