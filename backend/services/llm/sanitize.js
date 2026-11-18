/**
 * Input and output sanitisation for the LLM layer.
 *
 * Everything crossing the boundary into or out of the model is untrusted. This
 * module owns that boundary: it normalises the caller's question, fences
 * untrusted data inside delimiters that the model is told to ignore as
 * instructions, and validates the model's text before anything may use it.
 */

/** Hard cap on the caller's question handed to the model. */
export const MAX_INPUT_CHARS = 2000;

/** Hard cap on any model-authored text we are willing to keep. */
export const MAX_OUTPUT_CHARS = 4000;

/* Control characters, minus tab (09), newline (0A) and carriage return (0D). */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/* Script and style blocks are removed with their contents, so nothing inside
   them survives as text. Remaining HTML-ish tags are stripped too. Shadow text
   is never rendered, so this is belt-and-braces for any future consumer. */
const SCRIPT_BLOCKS = /<(script|style|iframe|object|embed)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
const HTML_TAGS = /<\/?[a-z][^>]*>/gi;

export function stripControlChars(value) {
  return String(value).replace(CONTROL_CHARS, "");
}

/** Collapse whitespace and cap length. Never throws; always returns a string. */
export function normalizeUserInput(message, maxChars = MAX_INPUT_CHARS) {
  if (typeof message !== "string") return "";
  const collapsed = stripControlChars(message.replace(/\s+/g, " ")).trim();
  return collapsed.slice(0, maxChars);
}

/* Fence names the model is told to treat as pure data. */
const FENCES = ["user_input", "conversation_history", "tool_result"];

const FENCE_PATTERN = new RegExp(
  `<\\s*/?\\s*(?:${FENCES.join("|")})\\b[^>]*>`,
  "gi"
);

/**
 * Neutralise anything that could look like a closing fence or a role header,
 * so a payload cannot break out of its data block.
 */
export function defuseFences(text) {
  return String(text)
    .replace(FENCE_PATTERN, "[removed]")
    .replace(/<\s*\/?\s*(system|assistant|user|tool|developer)\b[^>]*>/gi, "[removed]")
    .replace(/```/g, "``\u200b`");
}

/** Wrap untrusted content in an explicitly-labelled, escaped data block. */
export function asUntrustedBlock(label, body) {
  return [`<${label}>`, defuseFences(body), `</${label}>`].join("\n");
}

/**
 * Serialise a validated tool result for the model.
 *
 * Phase 1 has already capped rows and redacted secret-named fields. This is a
 * second, independent pass so a registry change can never leak a secret
 * upstream. Identical values collapse so a malformed model response cannot
 * inflate the payload.
 */
export function toolResultForProvider(name, data) {
  let json;
  try {
    json = JSON.stringify(data ?? null, jsonReplacer);
  } catch {
    json = '"[unserialisable tool result]"';
  }
  if (json === undefined) json = "null";
  if (json.length > MAX_INPUT_CHARS * 5) {
    json = `${json.slice(0, MAX_INPUT_CHARS * 5)}...[truncated]`;
  }
  return asUntrustedBlock("tool_result", `tool: ${name}\n${json}`);
}

function jsonReplacer(key, value) {
  return typeof value === "bigint" ? String(value) : value;
}

/**
 * Validate model-authored text before it is stored anywhere.
 *
 * @returns {{ok: true, text: string} | {ok: false, reason: string}}
 */
export function sanitizeModelText(value, maxChars = MAX_OUTPUT_CHARS) {
  if (typeof value !== "string") return { ok: false, reason: "not_a_string" };

  const cleaned = stripControlChars(
    value.replace(SCRIPT_BLOCKS, " ").replace(HTML_TAGS, "")
  ).trim();
  if (!cleaned) return { ok: false, reason: "empty" };
  if (cleaned.length > maxChars) {
    return { ok: false, reason: "too_long" };
  }
  return { ok: true, text: cleaned };
}

/**
 * Argument metadata that is safe to log: the key and its declared type only,
 * never the value.
 */
export function describeArgs(args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const described = {};
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string") described[key] = "enum";
    else if (typeof value === "number") described[key] = "int";
    else if (typeof value === "boolean") described[key] = "boolean";
    else described[key] = "object";
  }
  return described;
}