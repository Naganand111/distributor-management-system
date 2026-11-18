/**
 * Public surface of the AI tool layer.
 */

export { aiRegistry, AI_TOOLS, createToolRegistry } from "./tools/index.js";
export { detectPeriod, PERIODS } from "./tools/customer/periods.js";
export { ToolError, TOOL_ERROR_CODES } from "./errors.js";
export { AI_ROLE, MAX_ROWS } from "./constants.js";
export {
  LLM_ANSWER_BUDGET_MS,
  answerWithLlm,
  auditLlmAnswer,
  auditShadowResult,
  buildToolSchemas,
  runShadowOrchestration,
  scheduleShadow,
} from "./orchestrator.js";