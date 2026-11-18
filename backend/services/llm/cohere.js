/**
 * Minimal Cohere V2 Chat API provider.
 *
 * Mirrors openai.js exactly: same constructor signature, same `generate()`
 * contract, same normalized reply shape, same LlmError codes. Nothing here is
 * Cohere-specific below the wire format, so orchestrator.js, prompt.js and every
 * safety control are shared with the OpenAI path rather than duplicated.
 *
 * Uses global fetch and AbortController, so no provider SDK enters the
 * dependency tree. The API key is read from server configuration, attached to
 * one outbound header, and never logged, never returned and never included in
 * any error detail.
 *
 * Safety properties this file must not weaken:
 * - Tool schemas are metadata only. They describe registered, read-only tools.
 *   No SQL, connection string, credential or identity field is ever sent, and
 *   this adapter cannot execute anything: it returns a *request* for a tool and
 *   the registry remains the only path that runs one.
 * - Arguments come back as untrusted data and are validated by the registry.
 * - A provider error body can echo the prompt, so only the numeric HTTP status
 *   is ever retained.
 */

import { LLM_ERROR_CODES, LlmError } from "./errors.js";
import { resolveBaseUrl, validateLlmConfig } from "./config.js";

/** Cohere V2 caps a single response; this mirrors the OpenAI adapter's cap. */
const MAX_TOOL_CALLS = 5;

/** Cohere's documented temperature range for Command models. */
const MAX_TEMPERATURE = 1;

/** Join the configured base URL with the V2 chat path. */
function endpointFor(baseUrl) {
  return /\/chat$/.test(baseUrl) ? baseUrl : `${baseUrl}/chat`;
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

/**
 * Flatten Cohere's content-parts array into plain text.
 *
 * Only `text` parts contribute. Any other part type is dropped rather than
 * stringified, so an unfamiliar part cannot smuggle provider-controlled text
 * into the narration.
 */
function readTextParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts = [];
  for (const part of content) {
    if (!isPlainObject(part)) continue;
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  /* An empty parts array is Cohere's form of "this message carries no content
     at all". The OpenAI adapter rejects exactly that situation (its content
     must be a string), so both providers must answer alike: no content and no
     tool call is an invalid response, never a silently empty narration. */
  if (parts.length === 0) return null;
  return parts.join("");
}

/**
 * Convert the internal message format into Cohere V2 messages.
 *
 * Cohere V2 accepts `system`, `user`, `assistant` and `tool`. Our planner and
 * narrator only ever emit `system` and `user`; `assistant` and `tool` are
 * supported so the adapter stays correct if a future caller adds them.
 *
 * Tool results are never sent as instructions: the `tool` role carries them as
 * data, and the prompt's untrusted-data fences are preserved verbatim because
 * the message bodies are passed through unchanged.
 */
function toCohereMessages(messages) {
  const converted = [];

  for (const message of messages) {
    if (!isPlainObject(message)) continue;

    const text = readTextParts(message.content);
    if (text === null) continue;

    switch (message.role) {
      case "system":
      case "user":
      case "assistant":
        converted.push({ role: message.role, content: text });
        break;
      case "tool":
        /* Cohere requires a tool_call_id to bind a result to its call. Ours
           never sends one, so the turn is dropped rather than sent unbound. */
        if (typeof message.tool_call_id === "string" && message.tool_call_id) {
          converted.push({
            role: "tool",
            tool_call_id: message.tool_call_id,
            content: [{ type: "text", text }],
          });
        }
        break;
      default:
        /* An unknown role is never forwarded with its original meaning. */
        break;
    }
  }

  return converted;
}

/**
 * Convert the internal tool schema into Cohere's function format.
 *
 * The internal shape is {name, intent, description, parameters}. `intent` is
 * server-side routing metadata and is deliberately not sent: the model has no
 * use for it and it is not part of Cohere's schema.
 */
function toCohereTools(toolSchemas) {
  const tools = [];

  for (const schema of toolSchemas.slice(0, 50)) {
    if (!isPlainObject(schema) || typeof schema.name !== "string" || !schema.name) continue;

    tools.push({
      type: "function",
      function: {
        name: schema.name,
        description: typeof schema.description === "string" ? schema.description : "",
        /* Only a structured schema is forwarded. Anything else is omitted so a
           free-form `sql` or `query` string can never become a tool parameter. */
        parameters: isPlainObject(schema.parameters) ? schema.parameters : { type: "object", properties: {} },
      },
    });
  }

  return tools;
}

/**
 * Parse Cohere's tool calls defensively; anything unexpected is a failure.
 *
 * V2 nests the list under `message.tool_calls.tool_calls`. An array in that
 * position is also accepted so a future shape change cannot silently drop every
 * tool call.
 */
function readToolCalls(rawToolCalls) {
  const list = Array.isArray(rawToolCalls)
    ? rawToolCalls
    : isPlainObject(rawToolCalls) && Array.isArray(rawToolCalls.tool_calls)
      ? rawToolCalls.tool_calls
      : [];
  if (!list.length) return [];

  const calls = [];
  for (const call of list.slice(0, MAX_TOOL_CALLS)) {
    const fn = isPlainObject(call) ? call.function : null;
    if (!isPlainObject(fn) || typeof fn.name !== "string" || !fn.name) continue;

    let args = {};
    const rawArgs = fn.arguments;
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
    calls.push({ name: fn.name, args });
  }
  return calls;
}

/** Normalize Cohere's usage object. `tokens` is preferred over billed units. */
function readUsage(raw) {
  if (!isPlainObject(raw)) return null;

  const tokens = isPlainObject(raw.tokens) ? raw.tokens : {};
  const billed = isPlainObject(raw.billed_units) ? raw.billed_units : {};

  const promptTokens = numberOrNull(tokens.input_tokens ?? billed.input_tokens);
  const completionTokens = numberOrNull(tokens.output_tokens ?? billed.output_tokens);

  const total = numberOrNull(tokens.total_tokens ?? billed.total_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens: total ?? (promptTokens !== null || completionTokens !== null
      ? (promptTokens ?? 0) + (completionTokens ?? 0)
      : null),
    reported: true,
  };
}

/**
 * @param {object} config output of readLlmConfig()
 * @param {{fetchImpl?: typeof fetch}} [deps] injectable for tests
 */
export function createCohereProvider(config, deps = {}) {
  const check = validateLlmConfig(config);
  if (!check.ok) throw check.error;

  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new LlmError(LLM_ERROR_CODES.PROVIDER_UNAVAILABLE, "fetch unavailable");
  }

  const endpoint = endpointFor(resolveBaseUrl(config));

  async function generate(request = {}) {
    const sourceMessages = Array.isArray(request.messages) ? request.messages : [];
    const messages = toCohereMessages(sourceMessages);
    if (!messages.length) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "no messages");
    }

    /* Tools are offered on the planning turn only, exactly as on the OpenAI
       path, so the narration turn can never request a second execution. */
    const toolSchemas =
      request.purpose === "plan" && Array.isArray(request.toolSchemas)
        ? request.toolSchemas
        : [];
    const tools = toCohereTools(toolSchemas);

    const body = {
      model: config.model,
      messages,
      temperature: Math.min(config.temperature, MAX_TEMPERATURE),
      max_tokens: config.maxTokens,
      /* Non-streaming keeps one response object to parse. */
      stream: false,
    };
    if (tools.length) {
      body.tools = tools;
      body.tool_choice = "REQUIRED";
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
          accept: "application/json",
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

    if (!response || typeof response.status !== "number") {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "response was not an HTTP response");
    }

    /* Status only: a provider error body can echo the prompt, the tool result
       and, in the worst case, the submitted key. */
    if (!response.ok) {
      throw new LlmError(LLM_ERROR_CODES.PROVIDER_ERROR, `http ${response.status}`);
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "response was not JSON");
    }

    const message = payload?.message;
    if (!isPlainObject(message)) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "no message in response");
    }

    const toolCalls = readToolCalls(message.tool_calls);
    const finishReason = typeof payload?.finish_reason === "string" ? payload.finish_reason : null;
    const usage = readUsage(payload?.usage);
    const text = readTextParts(message.content);

    if (toolCalls.length) return { toolCalls, finishReason, usage };
    if (typeof text === "string") return { text, finishReason, usage };

    throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "message had neither content nor tool calls");
  }

  return { name: "cohere", model: config.model, endpoint, generate };
}