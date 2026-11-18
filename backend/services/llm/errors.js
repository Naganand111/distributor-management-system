/**
 * LLM layer errors.
 *
 * Every failure the provider or orchestrator can produce has a fixed code and a
 * generic, user-safe message. The raw cause is kept in `.detail` for server-side
 * logging only and is never returned to a caller or included in a shadow result.
 */

export const LLM_ERROR_CODES = Object.freeze({
  DISABLED: "llm_disabled",
  CONFIGURATION: "llm_configuration_error",
  INVALID_INPUT: "llm_invalid_input",
  NO_TOOL_INTENT: "llm_no_tool_for_intent",
  PROVIDER_UNAVAILABLE: "llm_provider_unavailable",
  TIMEOUT: "llm_timeout",
  PROVIDER_ERROR: "llm_provider_error",
  INVALID_RESPONSE: "llm_invalid_response",
  INVALID_OUTPUT: "llm_invalid_output",
  INVALID_TOOL_SELECTION: "llm_invalid_tool_selection",
  TOOL_REFUSED: "llm_tool_refused",
  TOOL_ERROR: "llm_tool_error",
  INJECTION: "llm_prompt_injection",
  LIMIT_EXCEEDED: "llm_limit_exceeded",
});

const SAFE_MESSAGES = Object.freeze({
  [LLM_ERROR_CODES.DISABLED]: "LLM is not enabled",
  [LLM_ERROR_CODES.CONFIGURATION]: "LLM configuration is invalid",
  [LLM_ERROR_CODES.INVALID_INPUT]: "No usable question was supplied",
  [LLM_ERROR_CODES.NO_TOOL_INTENT]: "No registered tool serves this intent",
  [LLM_ERROR_CODES.PROVIDER_UNAVAILABLE]: "LLM provider is unavailable",
  [LLM_ERROR_CODES.TIMEOUT]: "LLM provider timed out",
  [LLM_ERROR_CODES.PROVIDER_ERROR]: "LLM provider returned an error",
  [LLM_ERROR_CODES.INVALID_RESPONSE]: "LLM provider returned an invalid response",
  [LLM_ERROR_CODES.INVALID_OUTPUT]: "LLM returned unusable output",
  [LLM_ERROR_CODES.INVALID_TOOL_SELECTION]: "LLM selected an unusable tool",
  [LLM_ERROR_CODES.TOOL_REFUSED]: "LLM requested a tool it may not use",
  [LLM_ERROR_CODES.TOOL_ERROR]: "A tool call failed",
  [LLM_ERROR_CODES.INJECTION]: "Request refused as a prompt injection attempt",
  [LLM_ERROR_CODES.LIMIT_EXCEEDED]: "LLM call exceeded its configured limits",
});

export class LlmError extends Error {
  constructor(code, detail = null) {
    super(SAFE_MESSAGES[code] || "LLM call failed");
    this.name = "LlmError";
    this.code = code;
    /* Internal only. Never serialised into a response or a shadow result. */
    this.detail = detail;
  }

  toJSON() {
    return { code: this.code, message: this.message };
  }
}

export function toSafeLlmError(err) {
  if (err instanceof LlmError) return err;
  return new LlmError(LLM_ERROR_CODES.PROVIDER_ERROR, err);
}