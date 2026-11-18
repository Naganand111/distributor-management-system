/**
 * Public surface of the LLM service layer.
 *
 * `createLlmService()` never throws and never touches the network. With
 * LLM_ENABLED=false it returns a service whose provider is null, so no provider
 * is constructed, no key is required and nothing can be called by accident.
 */

import { getPublicLlmConfig, readLlmConfig, validateLlmConfig, SUPPORTED_PROVIDERS, resolveBaseUrl } from "./config.js";
import { LLM_ERROR_CODES, LlmError } from "./errors.js";
import { createMockProvider } from "./mock.js";
import { createOpenAiProvider } from "./openai.js";
import { createCohereProvider } from "./cohere.js";
import {
  SYSTEM_PROMPT,
  buildNarrationMessages,
  buildPlanMessages,
  screenInput,
} from "./prompt.js";
import { clearLlmMemory, llmMemoryStats, recentTurns, rememberTurn } from "./memory.js";
import {
  MAX_INPUT_CHARS,
  MAX_OUTPUT_CHARS,
  asUntrustedBlock,
  defuseFences,
  describeArgs,
  normalizeUserInput,
  sanitizeModelText,
  stripControlChars,
  toolResultForProvider,
} from "./sanitize.js";

/** Build the configured provider. Throws only on invalid configuration. */
export function createProvider(config, deps = {}) {
  switch (config.provider) {
    case "mock":
      return createMockProvider(deps.mockOptions || {});
    case "openai":
      return createOpenAiProvider(config, deps);
    case "cohere":
      return createCohereProvider(config, deps);
    default:
      throw new LlmError(LLM_ERROR_CODES.CONFIGURATION, "unknown provider");
  }
}

/**
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {object} [options.provider] pre-built provider, injected by tests
 * @param {object} [options.deps] provider dependencies, e.g. fetchImpl
 * @returns {{enabled: boolean, config: object, provider: object|null, error: LlmError|null}}
 */
export function createLlmService(options = {}) {
  const config = options.config || readLlmConfig(options.env || process.env);

  if (!config.enabled) {
    /* Disabled: no provider is constructed, so a missing API key cannot stop
       the backend from starting. */
    return { enabled: false, config, provider: null, error: null };
  }

  if (options.provider) {
    return { enabled: true, config, provider: options.provider, error: null };
  }

  const check = validateLlmConfig(config);
  if (!check.ok) {
    return { enabled: true, config, provider: null, error: check.error };
  }

  try {
    return { enabled: true, config, provider: createProvider(config, options.deps || {}), error: null };
  } catch (err) {
    return {
      enabled: true,
      config,
      provider: null,
      error: err instanceof LlmError ? err : new LlmError(LLM_ERROR_CODES.CONFIGURATION, err),
    };
  }
}

/** Default service for the running process. */
export function getLlmService(options = {}) {
  return createLlmService(options);
}

export function isLlmEnabled(env = process.env) {
  return readLlmConfig(env).enabled;
}

export {
  LLM_ERROR_CODES,
  LlmError,
  MAX_INPUT_CHARS,
  MAX_OUTPUT_CHARS,
  SUPPORTED_PROVIDERS,
  SYSTEM_PROMPT,
  asUntrustedBlock,
  buildNarrationMessages,
  buildPlanMessages,
  clearLlmMemory,
  createMockProvider,
  defuseFences,
  describeArgs,
  getPublicLlmConfig,
  llmMemoryStats,
  normalizeUserInput,
  readLlmConfig,
  recentTurns,
  rememberTurn,
  resolveBaseUrl,
  sanitizeModelText,
  screenInput,
  stripControlChars,
  toolResultForProvider,
  validateLlmConfig,
};