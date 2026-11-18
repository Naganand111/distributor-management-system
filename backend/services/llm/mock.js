/**
 * Deterministic mock provider.
 *
 * Used when LLM_PROVIDER=mock and as the default provider in tests, so the whole
 * orchestration path can be exercised with no network access and identical
 * results on every run. It also implements the "speak only in terms of the data
 * I was given" rule: its narration is derived from structure (row counts), never
 * by echoing text found in tool results.
 */

import { LLM_ERROR_CODES, LlmError } from "./errors.js";
import { defuseFences, normalizeUserInput } from "./sanitize.js";

/** Pull the fenced <user_input> body out of a planning turn. */
function readUserInput(messages) {
  for (const message of messages || []) {
    if (!message || typeof message.content !== "string") continue;
    const match = message.content.match(/<user_input>([\s\S]*?)<\/user_input>/);
    if (match) return normalizeUserInput(match[1], 500);
  }
  return "";
}

/** Count records in a serialised tool result without trusting its content. */
function countRecords(block) {
  if (typeof block !== "string") return 0;
  const start = block.indexOf("{");
  const end = block.lastIndexOf("}");
  if (start === -1 || end <= start) return 0;
  let parsed;
  try {
    parsed = JSON.parse(block.slice(start, end + 1));
  } catch {
    return 0;
  }
  return countArrays(parsed);
}

function countArrays(value, depth = 0) {
  if (depth > 4 || !value || typeof value !== "object") return 0;
  let total = 0;
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    if (Array.isArray(entry)) total += entry.length;
    else if (entry && typeof entry === "object") total += countArrays(entry, depth + 1);
  }
  return total;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "for", "and", "or", "is", "are", "was", "were", "in",
  "on", "to", "my", "me", "i", "what", "how", "much", "many", "show", "give",
  "list", "tell", "please", "can", "do", "does", "get", "all", "current", "last",
  "this", "that", "with", "from", "by", "at", "it", "be", "as", "up",
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

/**
 * Pick the tool whose name or description overlaps the question most.
 * Returns null when nothing overlaps, which is the "no tool" answer.
 */
export function pickTool(input, toolSchemas) {
  const tokens = tokenize(input);
  if (!tokens.length || !Array.isArray(toolSchemas)) return null;

  let best = null;
  let bestScore = 0;
  for (const schema of toolSchemas) {
    const nameTokens = tokenize(String(schema?.name || "").replace(/_/g, " "));
    const words = tokenize(`${nameTokens.join(" ")} ${schema?.description || ""}`);

    let score = 0;
    for (const token of tokens) {
      if (nameTokens.includes(token)) score += 2;
      else if (words.includes(token)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = schema;
    }
  }
  return bestScore > 0 ? best : null;
}

/** Build valid arguments from the schema's declared defaults. */
export function defaultArgsFor(schema) {
  const properties = schema?.parameters?.properties;
  if (!properties || typeof properties !== "object") return {};
  const args = {};
  for (const [name, spec] of Object.entries(properties)) {
    if (spec && spec.default !== undefined) args[name] = spec.default;
  }
  return args;
}

function planReply(request) {
  const input = readUserInput(request.messages);
  const tool = pickTool(input, request.toolSchemas);
  if (!tool) {
    return { toolCalls: [], text: "The requested data is not available.", finishReason: "stop" };
  }
  return {
    toolCalls: [{ name: tool.name, args: defaultArgsFor(tool) }],
    finishReason: "tool_calls",
  };
}

function narrateReply(request) {
  const last = [...(request.messages || [])].reverse().find((m) => typeof m?.content === "string");
  const block = last && typeof last.content === "string" ? last.content : "";
  const rows = countRecords(block);

  /* Built only from a count. No string from the tool result is ever echoed,
     so nothing inside the data can become an instruction or a leak. */
  const text =
    rows > 0
      ? `The tool returned ${rows} record${rows === 1 ? "" : "s"}. See the deterministic answer for figures.`
      : "The tool returned no matching records. See the deterministic answer.";

  return { text: defuseFences(text), finishReason: "stop" };
}

/**
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {Array}  [options.responses] scripted replies, consumed one per call:
 *        {kind:"tool_calls",toolCalls} | {kind:"text",text} | {kind:"error",code}
 *        | {kind:"delay",ms} | {kind:"invalid"}
 */
export function createMockProvider(options = {}) {
  const model = options.model || "mock-deterministic";
  const script = Array.isArray(options.responses) ? [...options.responses] : [];
  const requests = [];

  async function generate(request = {}) {
    requests.push(request);

    const chunk = script.length ? script.shift() : null;
    if (chunk) {
      if (chunk.kind === "error") {
        throw new LlmError(chunk.code || LLM_ERROR_CODES.PROVIDER_ERROR, "mock scripted error");
      }
      if (chunk.kind === "delay") {
        await sleep(chunk.ms ?? 50, request.signal);
        return request.purpose === "narrate"
          ? narrateReply(request)
          : planReply(request);
      }
      if (chunk.kind === "invalid") {
        return { text: 42, finishReason: "stop" };
      }
      if (chunk.kind === "tool_calls") {
        return {
          toolCalls: chunk.toolCalls || [],
          finishReason: "tool_calls",
        };
      }
      if (chunk.kind === "text") {
        return { text: chunk.text ?? "", finishReason: "stop" };
      }
    }

    return request.purpose === "narrate" ? narrateReply(request) : planReply(request);
  }

  return { name: "mock", model, generate, requests, scripted: script.length };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new LlmError(LLM_ERROR_CODES.TIMEOUT, "aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new LlmError(LLM_ERROR_CODES.TIMEOUT, "aborted"));
    }
    signal?.addEventListener?.("abort", onAbort, { once: true });
  });
}

export { sleep };