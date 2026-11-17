import { describe, expect, it } from 'vitest';
import {
  MINECRAFT_BEDROCK_GAME_NAME,
  MINECRAFT_GAME_SLUGS,
  MINECRAFT_PLUGIN_ID,
  editionOf,
} from '../minecraft-hub.constants.js';
import { HUB_PLUGIN_MANIFESTS, hubManifestFor } from '../plugin-hub-manifests.js';
import { normalizeForDedup, namesMatch } from '../game-identity/normalize-name.js';

describe('ROK-2234 — editionOf', () => {
  it('maps the Java and Bedrock slugs to their edition', () => {
    expect(editionOf('minecraft-java-edition')).toBe('java');
    expect(editionOf('minecraft-bedrock-edition')).toBe('bedrock');
  });

  it('returns null for any other slug, null or undefined', () => {
    expect(editionOf('valheim')).toBeNull();
    expect(editionOf('minecraft')).toBeNull();
    expect(editionOf('')).toBeNull();
    expect(editionOf(null)).toBeNull();
    expect(editionOf(undefined)).toBeNull();
  });
});

describe('ROK-2234 — HUB_PLUGIN_MANIFESTS.minecraft', () => {
  const m = hubManifestFor(MINECRAFT_PLUGIN_ID);

  it('owns both edition slugs and nothing renders yet', () => {
    expect(HUB_PLUGIN_MANIFESTS.minecraft.gameSlugs).toEqual([...MINECRAFT_GAME_SLUGS]);
    expect(m?.widgets).toEqual([]);
    expect(m?.tabs).toEqual([]);
    expect(m?.behaviours).toEqual([]);
  });

  it('declares the egg and the port, enable-query optional, no mod/secret/companion', () => {
    const reqs = m?.setup.requirements ?? [];
    expect(reqs.map((r) => [r.id, r.kind, r.required])).toEqual([
      ['pelican-server', 'pelican_egg', true],
      ['server-port', 'pelican_variable', true],
      ['enable-query', 'pelican_variable', false],
    ]);
    expect(reqs.every((r) => r.appliesTo?.includes('game_server'))).toBe(true);
    const kinds = reqs.map((r) => r.kind);
    expect(kinds).not.toContain('server_mod');
    expect(kinds).not.toContain('server_secret');
    expect(kinds).not.toContain('companion_app');
  });
});

describe('ROK-2234 — the Bedrock name never name-dedups onto the Java row', () => {
  it('"Minecraft: Bedrock Edition" does not match "Minecraft"', () => {
    const bedrock = normalizeForDedup(MINECRAFT_BEDROCK_GAME_NAME);
    expect(bedrock).toBe('minecraft bedrock edition');
    expect(namesMatch(bedrock, normalizeForDedup('Minecraft'))).toBe(false);
  });
});
