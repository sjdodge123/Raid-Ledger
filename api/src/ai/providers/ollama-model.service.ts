import { Injectable } from '@nestjs/common';
import { SettingsService } from '../../settings/settings.service';
import { AI_DEFAULTS, AI_SETTING_KEYS } from '../llm.constants';
import { fetchOllama } from './ollama.helpers';
import type { OllamaRawModel } from './ollama.helpers';

/**
 * Service for managing Ollama models (pull, delete, check).
 */
@Injectable()
export class OllamaModelService {
  constructor(private readonly settings: SettingsService) {}

  /** Resolve the Ollama base URL from settings or default. */
  private async getBaseUrl(): Promise<string> {
    const url = await this.settings.get(AI_SETTING_KEYS.OLLAMA_URL);
    return url || AI_DEFAULTS.ollamaUrl;
  }

  /** Pull a model from the Ollama registry. */
  async pullModel(modelId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await fetchOllama(baseUrl, '/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelId, stream: false }),
      timeoutMs: 600_000, // 10 minutes for large model downloads on NAS bandwidth
    });
  }

  /** Delete a model from the local Ollama instance. */
  async deleteModel(modelId: string): Promise<void> {
    const baseUrl = await this.getBaseUrl();
    await fetchOllama(baseUrl, '/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelId }),
    });
  }

  /** Check if a specific model is available locally. */
  async isModelAvailable(modelId: string): Promise<boolean> {
    try {
      const baseUrl = await this.getBaseUrl();
      const data = await fetchOllama<{ models: OllamaRawModel[] }>(
        baseUrl,
        '/api/tags',
      );
      return (data.models ?? []).some((m) => m.name === modelId);
    } catch {
      return false;
    }
  }
}
