/**
 * LLM configuration.
 *
 * Read from the environment with safe defaults. The LLM is OFF unless
 * LLM_ENABLED is explicitly true, and nothing here throws at import time: an
 * invalid configuration must never stop the deterministic AI from answering.
 *
 * Secrets are server-side only. REACT_APP_* variables are deliberately ignored
 * because anything prefixed that way is compiled into the frontend bundle.
 */

import { LLM_ERROR_CODES, LlmError } from "./errors.js";

export const SUPPORTED_PROVIDERS = Object.freeze(["mock", "openai", "cohere"]);

const DEFAULTS = Object.freeze({
  provider: "mock",
  maxTokens: 1024,
  temperature: 0,
  timeoutMs: 20000,
  maxToolIterations: 5,
});

/**
 * Official endpoint per provider, used only when LLM_BASE_URL is left empty.
 *
 * Cohere is given a default because its V2 chat path is stable and documented,
 * whereas OpenAI's base URL also carries the API version segment and is
 * therefore an explicit deployment choice. Overridable either way.
 */
const PROVIDER_DEFAULT_BASE_URL = Object.freeze({
  openai: "https://api.openai.com/v1",
  cohere: "https://api.cohere.ai/v2",
});

/**
 * The endpoint to actually call, honouring an explicit LLM_BASE_URL.
 * Never returns a trailing slash, so path joining stays predictable.
 */
export function resolveBaseUrl(config = {}) {
  const explicit = typeof config.baseUrl === "string" ? config.baseUrl.trim().replace(/\/+$/, "") : "";
  if (explicit) return explicit;
  return PROVIDER_DEFAULT_BASE_URL[config.provider] || "";
}

const LIMITS = Object.freeze({
  maxTokens: [1, 32000],
  temperature: [0, 2],
  timeoutMs: [100, 120000],
  maxToolIterations: [1, 10],
});

function readFlag(raw) {
  return /^(1|true|yes|on|enabled)$/i.test(String(raw ?? "").trim());
}

function readInt(raw, fallback, [min, max]) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isInteger(value) || value < min || value > max) return fallback;
  return value;
}

function readFloat(raw, fallback, [min, max]) {
  const text = String(raw ?? "").trim();
  if (!text) return fallback;
  const value = Number(text);
  if (!Number.isFinite(value) || value < min || value > max) return fallback;
  return value;
}

function readText(raw) {
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Build the effective LLM configuration.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {object} config, including the api key for server-side use only
 */
export function readLlmConfig(env = process.env) {
  const provider = readText(env.LLM_PROVIDER).toLowerCase() || DEFAULTS.provider;
  const baseUrl = readText(env.LLM_BASE_URL).replace(/\/+$/, "");

  return {
    enabled: readFlag(env.LLM_ENABLED),
    provider,
    /* Server-side secret. Never returned by getPublicLlmConfig(). */
    apiKey: readText(env.LLM_API_KEY),
    model: readText(env.LLM_MODEL),
    baseUrl,
    maxTokens: readInt(env.LLM_MAX_TOKENS, DEFAULTS.maxTokens, LIMITS.maxTokens),
    temperature: readFloat(env.LLM_TEMPERATURE, DEFAULTS.temperature, LIMITS.temperature),
    timeoutMs: readInt(env.LLM_TIMEOUT_MS, DEFAULTS.timeoutMs, LIMITS.timeoutMs),
    maxToolIterations: readInt(
      env.LLM_MAX_TOOL_ITERATIONS,
      DEFAULTS.maxToolIterations,
      LIMITS.maxToolIterations
    ),
  };
}

/**
 * The configuration with every secret removed. This is the only shape allowed
 * to reach a shadow result, a log line or a test assertion.
 */
export function getPublicLlmConfig(config = readLlmConfig()) {
  return Object.freeze({
    enabled: config.enabled,
    provider: config.provider,
    model: config.model || null,
    maxTokens: config.maxTokens,
    temperature: config.temperature,
    timeoutMs: config.timeoutMs,
    maxToolIterations: config.maxToolIterations,
    hasApiKey: Boolean(config.apiKey),
  });
}

/**
 * Validate configuration for use.
 *
 * @returns {{ok: true} | {ok: false, error: LlmError}}
 *          The error message is generic and never contains the secret.
 */
export function validateLlmConfig(config) {
  if (!config.enabled) return { ok: true, disabled: true };

  if (!SUPPORTED_PROVIDERS.includes(config.provider)) {
    return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "unknown provider") };
  }

  /* Both live providers are held to the same rules: a key, a model and a
     reachable http(s) endpoint. Cohere differs only in its default endpoint. */
  if (config.provider === "openai" || config.provider === "cohere") {
    if (!config.apiKey) {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "missing api key") };
    }
    if (!config.model) {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "missing model") };
    }
    const baseUrl = resolveBaseUrl(config);
    if (!baseUrl) {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "missing base url") };
    }

    /* Only absolute http(s) endpoints. Rejects file:, data: and other
       schemes that could be used to reach unexpected local resources. */
    let url;
    try {
      url = new URL(baseUrl);
    } catch {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "malformed base url") };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "unsupported url scheme") };
    }
    if (!url.hostname || url.hostname === '') {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "missing url host") };
    }
    if (process.env.NODE_ENV === "production" && url.protocol !== "https:") {
      return { ok: false, error: new LlmError(LLM_ERROR_CODES.CONFIGURATION, "https required in production") };
    }
  }

  return { ok: true, disabled: false };
}