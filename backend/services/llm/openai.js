/**
 * Minimal OpenAI-compatible chat-completions provider.
 *
 * Uses global fetch and AbortController, so no provider SDK is added to the
 * dependency tree. The API key is read from server configuration, attached to
 * one outbound header, and never logged, never returned and never included in
 * any error detail.
 */

import { LLM_ERROR_CODES, LlmError } from "./errors.js";
import { validateLlmConfig } from "./config.js";

/** Join the configured base URL with the completions path. */
function endpointFor(baseUrl) {
  return /\/chat\/completions$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Token counts only. Anything non-numeric is treated as absent, because these
 * numbers reach logs and must never be able to carry provider text through.
 */
function numberOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Parse the tool_calls array defensively; anything unexpected is a failure. */
function readToolCalls(rawCalls) {
  if (!Array.isArray(rawCalls)) return [];

  const calls = [];
  for (const call of rawCalls.slice(0, 5)) {
    if (!isPlainObject(call) || typeof call.function?.name !== "string") continue;

    let args = {};
    const rawArgs = call.function.arguments;
    if (typeof rawArgs === "string" && rawArgs.trim()) {
      try {
        args = JSON.parse(rawArgs);
      } catch {
        throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "unparsable tool arguments");
      }
    } else if (isPlainObject(rawArgs)) {
      args = rawArgs;
    }

    if (!isPlainObject(args)) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "tool arguments were not an object");
    }
    calls.push({ name: call.function.name, args });
  }
  return calls;
}

/**
 * @param {object} config output of readLlmConfig()
 * @param {{fetchImpl?: typeof fetch}} [deps] injectable for tests
 */
export function createOpenAiProvider(config, deps = {}) {
  const check = validateLlmConfig(config);
  if (!check.ok) throw check.error;

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new LlmError(LLM_ERROR_CODES.PROVIDER_UNAVAILABLE, "fetch unavailable");
  }

  const endpoint = endpointFor(config.baseUrl);

  async function generate(request = {}) {
    const messages = Array.isArray(request.messages) ? request.messages : [];
    if (!messages.length) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "no messages");
    }

    const toolSchemas =
      request.purpose === "plan" && Array.isArray(request.toolSchemas)
        ? request.toolSchemas
        : [];

    const body = {
      model: config.model,
      messages,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
    };
    if (toolSchemas.length) {
      body.tools = toolSchemas.map((schema) => ({
        type: "function",
        function: {
          name: schema.name,
          description: schema.description,
          parameters: schema.parameters,
        },
      }));
      body.tool_choice = "auto";
    }

    const controller = new AbortController();
    const timeoutMs = Number.isFinite(request.timeoutMs) ? request.timeoutMs : config.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    request.signal?.addEventListener?.("abort", onExternalAbort, { once: true });

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          /* The only place the key is ever read. */
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new LlmError(LLM_ERROR_CODES.TIMEOUT, "provider request aborted");
      }
      /* Network failure. `err` may embed the URL, so it is not retained. */
      throw new LlmError(LLM_ERROR_CODES.PROVIDER_UNAVAILABLE, "network failure");
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener?.("abort", onExternalAbort);
    }

    if (!response.ok) {
      /* Status only: a provider error body can echo the prompt. */
      throw new LlmError(LLM_ERROR_CODES.PROVIDER_ERROR, `http ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "response was not JSON");
    }

    const message = payload?.choices?.[0]?.message;
    if (!isPlainObject(message)) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "no choices in response");
    }

    const toolCalls = readToolCalls(message.tool_calls);
    const finishReason = payload?.choices?.[0]?.finish_reason ?? null;
    const usage = isPlainObject(payload?.usage)
      ? {
          promptTokens: numberOrNull(payload.usage.prompt_tokens),
          completionTokens: numberOrNull(payload.usage.completion_tokens),
          totalTokens: numberOrNull(payload.usage.total_tokens),
        }
      : null;

    if (toolCalls.length) return { toolCalls, finishReason, usage };
    if (typeof message.content === "string") return { text: message.content, finishReason, usage };

    throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "message had neither content nor tool calls");
  }

  return { name: "openai", model: config.model, endpoint, generate };
}