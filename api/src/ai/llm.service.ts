import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { LlmProviderRegistry } from './llm-provider-registry';
import { AiRequestLogService } from './ai-request-log.service';
import { CircuitBreaker } from './guardrails/circuit-breaker';
import { ConcurrencyLimiter } from './guardrails/concurrency-limiter';
import { LlmRateLimiter } from './guardrails/rate-limiter';
import { sanitizeInput } from './guardrails/input-sanitizer';
import { sanitizeOutput } from './guardrails/output-sanitizer';
import {
  prepareMessages,
  enforceTokenCap,
  executeWithTimeout,
} from './llm-pipeline.helpers';
import { AI_DEFAULTS, BASE_SYSTEM_PROMPT } from './llm.constants';
import type {
  LlmChatOptions,
  LlmChatResponse,
  LlmGenerateOptions,
  LlmGenerateResponse,
  LlmModelInfo,
  LlmRequestContext,
} from './llm-provider.interface';

/**
 * Facade service for all LLM interactions.
 * Applies guardrails (rate limiting, circuit breaking, sanitization)
 * before delegating to the active provider.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly circuitBreaker: CircuitBreaker;
  private readonly concurrencyLimiter: ConcurrencyLimiter;
  private readonly rateLimiter: LlmRateLimiter;

  constructor(
    private readonly registry: LlmProviderRegistry,
    private readonly logService: AiRequestLogService,
  ) {
    this.circuitBreaker = new CircuitBreaker(
      AI_DEFAULTS.circuitBreakerThreshold,
      AI_DEFAULTS.circuitBreakerCooldownMs,
    );
    this.concurrencyLimiter = new ConcurrencyLimiter(AI_DEFAULTS.maxConcurrent);
    this.rateLimiter = new LlmRateLimiter();
  }

  /** Send a chat request through the full guardrail pipeline. */
  async chat(
    options: LlmChatOptions,
    context: LlmRequestContext,
  ): Promise<LlmChatResponse> {
    const provider = await this.resolveOrThrow();
    this.applyPreChecks(context);
    const prepared = this.prepareChatOptions(options);
    const model = options.model ?? AI_DEFAULTS.model;
    const timeoutMs = context.timeoutMs ?? AI_DEFAULTS.timeoutMs;
    this.logChatEntry(provider.key, model, context.feature, timeoutMs);
    const start = Date.now();

    return this.concurrencyLimiter.withLimit(async () => {
      try {
        const response = await executeWithTimeout(
          () => provider.chat(prepared),
          timeoutMs,
        );
        this.circuitBreaker.recordSuccess();
        const sanitized = this.sanitizeChatResponse(response, context);
        await this.logSuccess(context, provider.key, sanitized, model);
        return sanitized;
      } catch (err) {
        this.logChatFailure(provider.key, model, start, err);
        this.circuitBreaker.recordFailure();
        await this.logFailure(context, provider.key, err, model);
        throw err;
      }
    });
  }

  /** Send a generate request through the full guardrail pipeline. */
  async generate(
    options: LlmGenerateOptions,
    context: LlmRequestContext,
  ): Promise<LlmGenerateResponse> {
    const provider = await this.resolveOrThrow();
    this.applyPreChecks(context);
    const sanitizedPrompt = sanitizeInput(options.prompt);
    const model = options.model ?? AI_DEFAULTS.model;

    return this.concurrencyLimiter.withLimit(async () => {
      try {
        const response = await executeWithTimeout(
          () => provider.generate({ ...options, prompt: sanitizedPrompt }),
          AI_DEFAULTS.timeoutMs,
        );
        this.circuitBreaker.recordSuccess();
        const sanitized = {
          ...response,
          content: sanitizeOutput(response.content, context.maxResponseLength),
        };
        await this.logSuccess(context, provider.key, sanitized, model);
        return sanitized;
      } catch (err) {
        this.circuitBreaker.recordFailure();
        await this.logFailure(context, provider.key, err, model);
        throw err;
      }
    });
  }

  /** Check if the active provider is reachable. */
  async isAvailable(): Promise<boolean> {
    const provider = await this.registry.resolveActive();
    if (!provider) return false;
    return provider.isAvailable();
  }

  /** List models from the active provider. */
  async listModels(): Promise<LlmModelInfo[]> {
    const provider = await this.resolveOrThrow();
    return provider.listModels();
  }

  private async resolveOrThrow() {
    const provider = await this.registry.resolveActive();
    if (!provider) {
      throw new NotFoundException('No AI provider configured');
    }
    return provider;
  }

  /** Log diagnostic info on chat entry. */
  private logChatEntry(
    providerKey: string,
    model: string,
    feature: string,
    timeoutMs: number,
  ): void {
    this.logger.log(
      `LLM chat | provider=${providerKey} model=${model} feature=${feature} timeout=${timeoutMs}ms`,
    );
  }

  /** Log diagnostic warning on chat failure. */
  private logChatFailure(
    providerKey: string,
    model: string,
    start: number,
    err: unknown,
  ): void {
    const elapsed = Date.now() - start;
    const message = err instanceof Error ? err.message : 'Unknown error';
    this.logger.warn(
      `LLM chat failed | provider=${providerKey} model=${model} elapsed=${elapsed}ms error=${message}`,
    );
  }

  private applyPreChecks(context: LlmRequestContext): void {
    if (context.userId) {
      this.rateLimiter.checkRateLimit(
        context.userId,
        AI_DEFAULTS.rateLimitPerMinute,
      );
    }
    this.circuitBreaker.checkState();
  }

  private prepareChatOptions(options: LlmChatOptions): LlmChatOptions {
    const sanitizedMessages = options.messages.map((m) =>
      m.role === 'user' ? { ...m, content: sanitizeInput(m.content) } : m,
    );
    const prepared = {
      ...options,
      messages: prepareMessages(sanitizedMessages, BASE_SYSTEM_PROMPT),
    };
    enforceTokenCap(prepared, AI_DEFAULTS.maxTokens);
    return prepared;
  }

  private sanitizeChatResponse(
    response: LlmChatResponse,
    context: LlmRequestContext,
  ): LlmChatResponse {
    return {
      ...response,
      content: sanitizeOutput(response.content, context.maxResponseLength),
    };
  }

  private async logSuccess(
    context: LlmRequestContext,
    providerKey: string,
    response: {
      usage?: { promptTokens: number; completionTokens: number };
      latencyMs: number;
    },
    model: string,
  ): Promise<void> {
    await this.logService
      .log({
        feature: context.feature,
        userId: context.userId,
        provider: providerKey,
        model,
        promptTokens: response.usage?.promptTokens,
        completionTokens: response.usage?.completionTokens,
        latencyMs: response.latencyMs,
        success: true,
      })
      .catch((err: unknown) =>
        this.logger.error('Failed to log AI request', err),
      );
  }

  private async logFailure(
    context: LlmRequestContext,
    providerKey: string,
    err: unknown,
    model: string,
  ): Promise<void> {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await this.logService
      .log({
        feature: context.feature,
        userId: context.userId,
        provider: providerKey,
        model,
        latencyMs: 0,
        success: false,
        errorMessage: message,
      })
      .catch((logErr: unknown) =>
        this.logger.error('Failed to log AI request error', logErr),
      );
  }
}
