/**
 * Safe error type for the AI tool layer.
 *
 * Rule: only `code` and `safeMessage` may ever reach a client.
 * The original message, stack, SQL text and driver details stay internal.
 */

export const TOOL_ERROR_CODES = Object.freeze({
  UNKNOWN_TOOL: "unknown_tool",
  FORBIDDEN_ROLE: "forbidden_role",
  FORBIDDEN_ARGUMENT: "forbidden_argument",
  UNKNOWN_ARGUMENT: "unknown_argument",
  INVALID_ARGUMENT: "invalid_argument",
  MISSING_ARGUMENT: "missing_argument",
  OUTPUT_SHAPE: "output_shape",
  TOOL_FAILURE: "tool_failure",
});

const SAFE_MESSAGES = Object.freeze({
  [TOOL_ERROR_CODES.UNKNOWN_TOOL]: "That assistant capability is not available.",
  [TOOL_ERROR_CODES.FORBIDDEN_ROLE]: "You are not allowed to use this assistant capability.",
  [TOOL_ERROR_CODES.FORBIDDEN_ARGUMENT]: "That request contained an argument the assistant will not accept.",
  [TOOL_ERROR_CODES.UNKNOWN_ARGUMENT]: "That request contained an argument the assistant does not support.",
  [TOOL_ERROR_CODES.INVALID_ARGUMENT]: "That request contained an invalid argument value.",
  [TOOL_ERROR_CODES.MISSING_ARGUMENT]: "That request was missing a required argument.",
  [TOOL_ERROR_CODES.OUTPUT_SHAPE]: "The assistant could not read the result of that request.",
  [TOOL_ERROR_CODES.TOOL_FAILURE]: "The assistant could not complete that request.",
});

export class ToolError extends Error {
  constructor(code, status = 400, detail = null) {
    super(SAFE_MESSAGES[code] || SAFE_MESSAGES[TOOL_ERROR_CODES.TOOL_FAILURE]);
    this.name = "ToolError";
    this.code = code;
    this.status = status;
    this.safeMessage = SAFE_MESSAGES[code] || SAFE_MESSAGES[TOOL_ERROR_CODES.TOOL_FAILURE];
    // Internal only. Never serialised to a response.
    this.detail = detail;
  }
}

export function invalidArgument(detail) {
  return new ToolError(TOOL_ERROR_CODES.INVALID_ARGUMENT, 400, detail);
}

export function forbiddenArgument(detail) {
  return new ToolError(TOOL_ERROR_CODES.FORBIDDEN_ARGUMENT, 400, detail);
}

export function unknownArgument(detail) {
  return new ToolError(TOOL_ERROR_CODES.UNKNOWN_ARGUMENT, 400, detail);
}

export function missingArgument(detail) {
  return new ToolError(TOOL_ERROR_CODES.MISSING_ARGUMENT, 400, detail);
}

export function forbiddenRole(detail) {
  return new ToolError(TOOL_ERROR_CODES.FORBIDDEN_ROLE, 403, detail);
}

export function unknownTool(detail) {
  return new ToolError(TOOL_ERROR_CODES.UNKNOWN_TOOL, 404, detail);
}

export function outputShape(detail) {
  return new ToolError(TOOL_ERROR_CODES.OUTPUT_SHAPE, 500, detail);
}

export function toolFailure(detail) {
  return new ToolError(TOOL_ERROR_CODES.TOOL_FAILURE, 500, detail);
}

/**
 * Coerce anything thrown inside a tool into a safe, client-ready ToolError.
 * Raw driver/SQL/stack text never leaks past this point.
 */
export function toSafeToolError(err) {
  if (err instanceof ToolError) return err;
  return new ToolError(TOOL_ERROR_CODES.TOOL_FAILURE, 500, {
    cause: err && err.message ? err.message : String(err),
    name: err && err.name ? err.name : "UnknownError",
  });
}