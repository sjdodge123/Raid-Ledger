/**
 * Unit tests for `activeProviderInfo` (ROK-1139).
 *
 * The provenance `model` stored with every suggestion row must be the model
 * the curator call actually ran on: the active provider's default model,
 * because `LlmService.chat` falls back to `provider.defaultModel` and the
 * curator passes no `options.model`. A stale `ai_model` setting (e.g. an old
 * Ollama tag left behind after switching to Claude) must not override it.
 */
import { AI_SETTING_KEYS } from '../../ai/llm.constants';
import { activeProviderInfo, type GenerateDeps } from './generate.helpers';

const CLAUDE_DEFAULT = 'claude-sonnet-4-20250514';

function buildDeps(opts: {
  settings: Record<string, string | null>;
  providerKey: string | null;
  defaultModel: string | null;
}): GenerateDeps {
  return {
    settings: {
      get: jest.fn((key: string) =>
        Promise.resolve(opts.settings[key] ?? null),
      ),
    },
    llmService: {
      getActiveProviderKey: jest.fn().mockResolvedValue(opts.providerKey),
      getActiveDefaultModel: jest.fn().mockResolvedValue(opts.defaultModel),
    },
    db: {},
    gameTaste: {},
  } as unknown as GenerateDeps;
}

describe('activeProviderInfo', () => {
  it("records the active provider's default model, not a stale ai_model setting", async () => {
    const deps = buildDeps({
      settings: {
        [AI_SETTING_KEYS.PROVIDER]: 'claude',
        [AI_SETTING_KEYS.MODEL]: 'llama3.2:3b',
      },
      providerKey: 'claude',
      defaultModel: CLAUDE_DEFAULT,
    });

    await expect(activeProviderInfo(deps)).resolves.toEqual({
      provider: 'claude',
      model: CLAUDE_DEFAULT,
    });
  });

  it('falls back to the registry provider key when no provider setting is saved', async () => {
    const deps = buildDeps({
      settings: {},
      providerKey: 'google',
      defaultModel: 'gemini-2.0-flash',
    });

    await expect(activeProviderInfo(deps)).resolves.toEqual({
      provider: 'google',
      model: 'gemini-2.0-flash',
    });
  });

  it("records 'unknown' for both when no provider resolves", async () => {
    const deps = buildDeps({
      settings: {},
      providerKey: null,
      defaultModel: null,
    });

    await expect(activeProviderInfo(deps)).resolves.toEqual({
      provider: 'unknown',
      model: 'unknown',
    });
  });
});
