/**
 * LLM orchestration, SHADOW MODE ONLY.
 *
 * Flow: authenticated actor -> screen the question -> ask the provider for a
 * tool plan -> validate every selection against the Phase 1 registry ->
 * execute through aiRegistry -> hand only the validated result back for
 * narration -> validate the model's text -> return a shadow result.
 *
 * Three invariants hold regardless of what the model asks for:
 *   1. aiRegistry is the only execution path. The model cannot reach SQL, a
 *      table name, an identity argument or an unregistered tool.
 *   2. Tool results are fenced untrusted data, never instructions.
 *   3. Nothing in this module touches an HTTP response. It returns a value and
 *      never throws, so the deterministic answer is always the one the user sees.
 */

import { aiRegistry } from "./tools/index.js";
import { countRows } from "./validator.js";
import {
  LLM_ERROR_CODES,
  LlmError,
  createLlmService,
  getPublicLlmConfig,
  recentTurns,
  rememberTurn,
  asUntrustedBlock,
  describeArgs,
  normalizeUserInput,
  sanitizeModelText,
  toolResultForProvider,
} from "../llm/index.js";
import {
  SYSTEM_PROMPT,
  buildNarrationMessages,
  buildPlanMessages,
  screenInput,
} from "../llm/prompt.js";

const DEFAULT_TIMEOUT_MS = 20000;

/**
 * Hard ceiling on how long a user-visible answer may wait for a model.
 *
 * The frontend aborts AI requests at 20s. Waiting the full provider timeout
 * would turn a slow provider into a failed request even though the
 * deterministic answer was already computed. Anything slower than this budget
 * abandons the model and returns the deterministic answer instead.
 */
export const LLM_ANSWER_BUDGET_MS = 12000;

/* ------------------------------------------------------------------ *
 * Precomputed tool result (M2 — single execution per request)
 * ------------------------------------------------------------------ */

/**
 * Private brand for a result the route already produced through its own
 * authorized tool execution. JSON has no symbols and this symbol is
 * module-private, so a value originating in an untrusted HTTP body can never
 * satisfy it. The only way to build a valid value is this exported sealer,
 * which trusted route code calls with its own tool output.
 */
const PRECOMPUTED_BRAND = Symbol("ai.precomputedToolResult");

/**
 * Seal the exact `executed.data` payload from a route's authorized tool call.
 * The orchestrator may narrate from it without running the tool a second time.
 *
 * @param {string} toolName registry tool that produced `data`
 * @param {*} data the route's `executed.data` payload
 */
export function sealPrecomputedToolResult(toolName, data) {
  return { [PRECOMPUTED_BRAND]: true, toolName, data };
}

/** Unwrap a sealed result only when it matches the tool this run expects. */
function readPrecomputedToolResult(value, expectedTool) {
  if (!value || typeof value !== "object" || value[PRECOMPUTED_BRAND] !== true) {
    return { ok: false };
  }
  if (value.toolName !== expectedTool || !("data" in value)) {
    return { ok: false };
  }
  return { ok: true, data: value.data };
}

/** Convert a Phase 1 argument schema into a strict JSON Schema for the model. */
function toJsonSchema(inputSchema) {
  const properties = {};
  const required = [];

  for (const [name, spec] of Object.entries(inputSchema || {})) {
    const property = {};
    switch (spec.type) {
      case "int":
        property.type = "integer";
        if (spec.min !== undefined) property.minimum = spec.min;
        if (spec.max !== undefined) property.maximum = spec.max;
        break;
      case "enum":
        property.type = "string";
        property.enum = [...spec.values];
        break;
      case "date":
        property.type = "string";
        property.format = "date";
        break;
      case "boolean":
        property.type = "boolean";
        break;
      default:
        property.type = "string";
    }
    if (spec.default !== undefined) property.default = spec.default;
    if (spec.maxLength !== undefined) property.maxLength = spec.maxLength;

    properties[name] = property;
    if (spec.required) required.push(name);
  }

  /* additionalProperties:false tells the model not to invent arguments. */
  const schema = { type: "object", properties, additionalProperties: false };
  if (required.length) schema.required = required;
  return schema;
}

/**
 * The tool catalogue offered to the model.
 *
 * Derived from the registry filtered by the caller's role, so the model can only
 * ever be offered tools that actor is already authorised to run. There is no
 * second list of tools anywhere in the LLM layer.
 */
export function buildToolSchemas(role, registry = aiRegistry) {
  return registry
    .listForRole(role)
    .map((tool) => ({
      name: tool.name,
      intent: tool.intent,
      description: tool.description,
      parameters: toJsonSchema(tool.inputSchema),
    }));
}

function baseResult({ publicConfig, surface, role }) {
  return {
    enabled: true,
    provider: publicConfig.provider,
    model: publicConfig.model,
    surface: surface || null,
    role: role || null,
    intent: null,
    selectedTool: null,
    toolArgs: {},
    toolRowCount: null,
    answer: null,
    latencyMs: 0,
    success: false,
    errorCode: null,
    usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false },
  };
}

function finish(base, startedAt, extra = {}) {
  return { ...base, latencyMs: Number(process.hrtime.bigint() - startedAt) / 1e6, ...extra };
}

/** Reject a provider reply that is not the shape the contract promises. */
function readPlannedCalls(reply) {
  if (!reply || typeof reply !== "object" || Array.isArray(reply)) {
    throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "reply was not an object");
  }
  if (reply.toolCalls === undefined && typeof reply.text !== "string") {
    throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "reply had no toolCalls or text");
  }
  if (reply.toolCalls === undefined) return [];

  if (!Array.isArray(reply.toolCalls)) {
    throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "toolCalls was not an array");
  }

  return reply.toolCalls.map((call) => {
    if (!call || typeof call !== "object" || typeof call.name !== "string" || !call.name) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_TOOL_SELECTION, "tool call had no name");
    }
    const args = call.args === undefined ? {} : call.args;
    if (args === null || typeof args !== "object" || Array.isArray(args)) {
      throw new LlmError(LLM_ERROR_CODES.INVALID_TOOL_SELECTION, "tool call args were not an object");
    }
    return { name: call.name, args };
  });
}

/** Stable key used to reject a repeated call and break loops. */
function callKey(name, args) {
  return `${name}:${JSON.stringify(args, Object.keys(args || {}).sort())}`;
}

/**
 * Run one shadow orchestration.
 *
 * Never throws and never returns a value that could be mistaken for a client
 * response. Callers ignore the result in production; it exists for tests,
 * comparison and future review.
 *
 * @returns {Promise<object>} shadow result
 */
export async function runShadowOrchestration(options = {}) {
  const startedAt = process.hrtime.bigint();
  const {
    actor = {},
    message,
    db,
    surface = null,
    conversationId = null,
    registry = aiRegistry,
    service = null,
    expectedTool = null,
    precomputedResult = null,
  } = options;

  const llm = service || createLlmService();
  const publicConfig = getPublicLlmConfig(llm.config);
  const base = baseResult({ publicConfig, surface, role: actor.role });

  /* Token counts are summed across the plan and narration turns. Only these
     three integers are ever kept: no prompt, no completion, no usage text. */
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reported: false };
  const collectUsage = (reply) => {
    const reported = reply && reply.usage;
    if (!reported) return;
    if (
      typeof reported.promptTokens === "number" ||
      typeof reported.completionTokens === "number" ||
      typeof reported.totalTokens === "number"
    ) {
      usage.reported = true;
    }
    usage.promptTokens += Number.isFinite(reported.promptTokens) ? reported.promptTokens : 0;
    usage.completionTokens += Number.isFinite(reported.completionTokens) ? reported.completionTokens : 0;
    usage.totalTokens += Number.isFinite(reported.totalTokens) ? reported.totalTokens : 0;
  };
  /* Every exit settles through this, so usage is never silently dropped and no
     return path can forget it. */
  const settle = (extra = {}) => finish({ ...base, usage: { ...usage } }, startedAt, extra);

  if (!llm.enabled) {
    return settle({ enabled: false, errorCode: LLM_ERROR_CODES.DISABLED });
  }
  if (llm.error || !llm.provider) {
    return settle({ errorCode: LLM_ERROR_CODES.CONFIGURATION });
  }

  /* The actor is authenticated upstream. Without a role there is no catalogue,
     and without a user id no customer tool may run. */
  if (typeof actor.role !== "string" || !actor.role) {
    return settle({ errorCode: LLM_ERROR_CODES.TOOL_REFUSED });
  }
  if (actor.userId === undefined || actor.userId === null) {
    return settle({ errorCode: LLM_ERROR_CODES.TOOL_REFUSED });
  }

  const input = normalizeUserInput(message);
  if (!input) {
    return settle({ errorCode: LLM_ERROR_CODES.INVALID_INPUT });
  }

  /* Refuse obvious attacks before spending a provider call. */
  const screen = screenInput(input);
  if (screen.blocked) {
    return settle({ errorCode: LLM_ERROR_CODES.INJECTION });
  }

  const history = recentTurns(conversationId);
  rememberTurn(conversationId, message);

  const toolSchemas = buildToolSchemas(actor.role, registry);
  const allowedNames = new Set(toolSchemas.map((schema) => schema.name));
  const maxCalls = Math.max(1, llm.config.maxToolIterations || 1);
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? options.timeoutMs
    : llm.config.timeoutMs || DEFAULT_TIMEOUT_MS;

  /* One deadline covers the whole run, so a slow plan plus a slow narration
     still cannot exceed the configured timeout. */
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const historyBlock = history.length
      ? asUntrustedBlock("conversation_history", history.join("\n"))
      : asUntrustedBlock("conversation_history", "(none)");

    const planMessages = buildPlanMessages({
      systemPrompt: SYSTEM_PROMPT,
      input,
      historyBlock,
      toolNames: toolSchemas.map((schema) => schema.name),
    });

    const planReply = await llm.provider.generate({
      purpose: "plan",
      messages: planMessages,
      toolSchemas,
      maxTokens: llm.config.maxTokens,
      temperature: llm.config.temperature,
      timeoutMs,
      signal: controller.signal,
    });

    const planned = readPlannedCalls(collectUsage(planReply) || planReply);

    /* Hard cap on tool executions, plus deduplication, so a looping or
       over-eager plan cannot fan out. */
    let truncated = false;
    const unique = [];
    const seen = new Set();
    for (const call of planned) {
      if (unique.length >= maxCalls) {
        truncated = true;
        break;
      }
      const key = callKey(call.name, call.args);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(call);
    }

    /* A plan that needed more calls than the cap allows is not one we are
       willing to narrate for a user. Shadow mode records it and carries on;
       the live path abandons it for the deterministic answer. */
    if (expectedTool && truncated) {
      return settle({ errorCode: LLM_ERROR_CODES.LIMIT_EXCEEDED });
    }

    /* Live path: the deterministic detector already decided what the question
       means, so the model may only use the tool that serves that intent. Any
       other selection is discarded without being executed, which keeps the
       narrated answer and the returned data describing the same thing. */
    const executable = expectedTool
      ? unique.filter((call) => call.name === expectedTool)
      : unique;

    if (expectedTool && executable.length === 0) {
      return settle({
        selectedTool: planned[0] ? planned[0].name : null,
        toolArgs: planned[0] ? describeArgs(planned[0].args) : {},
        errorCode: LLM_ERROR_CODES.INVALID_TOOL_SELECTION,
      });
    }

    /* M2: when the route handed us a sealed result for this exact expected
       tool, reuse it for narration instead of executing the tool again. Any
       missing, unsealed or mismatched value falls back to the original
       tool-execution path below, so all existing behaviour is preserved. */
    const pre = readPrecomputedToolResult(precomputedResult, expectedTool);
    const usePrecomputed = pre.ok && Boolean(expectedTool) && executable.length === 1;

    const results = [];
    let lastArgs = {};
    for (const call of executable) {
      if (!allowedNames.has(call.name)) {
        /* Unregistered, or registered but not for this role. Either way the
           model gets nothing: this is a refusal, not a fallback. */
        return settle({
          selectedTool: call.name,
          toolArgs: describeArgs(call.args),
          errorCode: registry.has(call.name)
            ? LLM_ERROR_CODES.TOOL_REFUSED
            : LLM_ERROR_CODES.INVALID_TOOL_SELECTION,
        });
      }

      if (usePrecomputed) {
        /* The route already ran this exact authorized tool for this actor and
           handed us its data. Narrate from that result — the tool must not be
           executed a second time for the same request. */
        results.push({ name: call.name, data: pre.data });
        lastArgs = call.args;
        continue;
      }

      try {
        const executed = await registry.execute({
          toolName: call.name,
          /* Identity always comes from the authenticated actor. */
          actor: { userId: actor.userId, role: actor.role },
          args: call.args,
          db,
          intent: undefined,
        });

        results.push({ name: call.name, data: executed.data });
        lastArgs = call.args;
      } catch {
        /* A tool that fails validation, or the database, ends the shadow run.
           The deterministic answer is unaffected either way. */
        return settle({
          selectedTool: call.name,
          toolArgs: describeArgs(call.args),
          errorCode: LLM_ERROR_CODES.TOOL_ERROR,
        });
      }
    }

    const first = results[0];
    const resultBlock = results.length
      ? results.map((entry) => toolResultForProvider(entry.name, entry.data)).join("\n\n")
      : asUntrustedBlock("tool_result", "no tool was called; no data was returned");

    const narrationMessages = buildNarrationMessages({
      systemPrompt: SYSTEM_PROMPT,
      input,
      toolResultBlock: resultBlock,
    });

    const narrationReply = await llm.provider.generate({
      purpose: "narrate",
      messages: narrationMessages,
      toolSchemas: [],
      maxTokens: llm.config.maxTokens,
      temperature: llm.config.temperature,
      timeoutMs,
      signal: controller.signal,
    });

    collectUsage(narrationReply);

    if (!narrationReply || typeof narrationReply.text !== "string") {
      throw new LlmError(LLM_ERROR_CODES.INVALID_RESPONSE, "narration had no text");
    }

    const clean = sanitizeModelText(narrationReply.text);
    if (!clean.ok) {
      return settle({
        selectedTool: first ? first.name : null,
        toolArgs: describeArgs(lastArgs),
        toolRowCount: first ? countRows(first.data) : null,
        errorCode: LLM_ERROR_CODES.INVALID_OUTPUT,
      });
    }

    return settle({
      intent: first ? registry.get(first.name)?.intent ?? null : null,
      selectedTool: first ? first.name : null,
      toolArgs: describeArgs(lastArgs),
      toolRowCount: first ? countRows(first.data) : null,
      answer: clean.text,
      success: true,
      truncated,
    });
  } catch (err) {
    const code =
      err instanceof LlmError ? err.code : LLM_ERROR_CODES.PROVIDER_ERROR;
    return settle({ errorCode: code });
  } finally {
    clearTimeout(deadline);
  }
}

/**
 * Fire-and-forget shadow execution for a route.
 *
 * Called after the response has been sent. It is wrapped in try/catch so it can
 * neither throw into the request nor delay it, and it returns immediately.
 */
export function scheduleShadow(options = {}) {
  try {
    const service = options.service || createLlmService();
    /* Disabled means no provider is constructed and nothing is called. */
    if (!service.enabled) return null;

    setImmediate(() => {
      runShadowOrchestration({ ...options, service })
        .then((result) => auditShadowResult(result))
        .catch(() => {
          /* runShadowOrchestration does not reject; this is belt-and-braces. */
        });
    });
    return null;
  } catch {
    return null;
  }
}

/**
 * Shadow-mode audit line.
 *
 * Metadata only, following the Phase 1 policy: tool, intent, actor id, role,
 * argument keys, row count, outcome, error code. Never the question, the tool
 * result, SQL, credentials or the model's text.
 */
export function auditShadowResult(result) {
  try {
    if (!result || !result.enabled) return;
    const parts = [
      "[AI-SHADOW]",
      `provider=${result.provider}`,
      `model=${result.model || "unset"}`,
      `surface=${result.surface || "none"}`,
      `role=${result.role || "none"}`,
      `tool=${result.selectedTool || "none"}`,
      `intent=${result.intent || "none"}`,
      `argKeys=${Object.keys(result.toolArgs || {}).join("+") || "none"}`,
      `rows=${result.toolRowCount === null || result.toolRowCount === undefined ? "none" : result.toolRowCount}`,
      `latencyMs=${Math.round(result.latencyMs)}`,
      `outcome=${result.success ? "success" : "skipped"}`,
    ];
    if (result.errorCode) parts.push(`errorCode=${result.errorCode}`);
    if (result.truncated) parts.push("truncated=true");

    if (result.success) console.log(parts.join(" "));
    else console.warn(parts.join(" "));
  } catch {
    /* auditing must never break anything */
  }
}

/**
 * Phase 3 live path: produce a user-visible answer from the LLM.
 *
 * Returns a decision, never text the caller should use blindly. The route keeps
 * its deterministic answer unless `ok` is true, so every failure mode below
 * degrades to that answer rather than to an error:
 *
 *   disabled LLM | invalid configuration | provider failure | timeout
 *   invalid output | unknown or wrong-role tool | bad arguments | tool failure
 *   iteration cap | injection attempt | non tool-backed intent
 *
 * A route may pass `precomputedResult` (created with sealPrecomputedToolResult
 * from its own authorized tool call) so the selected tool runs exactly once.
 * The brand cannot be forged from request data, and a missing or mismatched
 * value simply keeps the original re-execute path.
 *
 * @returns {Promise<{ok: boolean, text: string|null, reason: string|null}>}
 */
export async function answerWithLlm(options = {}) {
  const { actor = {}, deterministicIntent = null, registry = aiRegistry } = options;

  try {
    const service = options.service || createLlmService();

    if (!service.enabled) {
      return { ok: false, text: null, reason: LLM_ERROR_CODES.DISABLED };
    }

    /* Clarification, fallback and out-of-scope have no tool result, so a model
       could only invent one. Those stay deterministic. */
    if (!deterministicIntent || !registry.toolNameForIntent(deterministicIntent)) {
      auditLlmAnswer({ skipped: LLM_ERROR_CODES.NO_TOOL_INTENT, actor, deterministicIntent, surface: options.surface });
      return { ok: false, text: null, reason: LLM_ERROR_CODES.NO_TOOL_INTENT };
    }

    /* Fail closed before spending a provider call when the intent's tool is not
       one this actor may run at all. */
    const expectedTool = registry.toolNameForIntent(deterministicIntent);
    const expected = registry.get(expectedTool);
    if (!expected || typeof actor.role !== "string" || !expected.allowedRoles.includes(actor.role)) {
      auditLlmAnswer({ skipped: LLM_ERROR_CODES.TOOL_REFUSED, actor, deterministicIntent, surface: options.surface });
      return { ok: false, text: null, reason: LLM_ERROR_CODES.TOOL_REFUSED };
    }

    const budget = Number.isFinite(options.timeoutMs)
      ? options.timeoutMs
      : Math.min(service.config.timeoutMs || DEFAULT_TIMEOUT_MS, LLM_ANSWER_BUDGET_MS);

    const result = await runShadowOrchestration({
      ...options,
      registry,
      service,
      surface: options.surface || "admin",
      expectedTool,
      timeoutMs: budget,
    });

    auditLlmAnswer({ result, actor, deterministicIntent, surface: options.surface });

    return {
      ok: result.success === true,
      text: result.success === true ? result.answer : null,
      reason: result.success === true ? null : result.errorCode,
      result,
    };
  } catch {
    /* Never propagate: a broken LLM must not become a failed request. */
    return { ok: false, text: null, reason: LLM_ERROR_CODES.PROVIDER_ERROR };
  }
}

/**
 * Phase 3 / Phase 5 audit line.
 *
 * Same policy as the Phase 1 and Phase 2 lines: metadata only. Never the user
 * message, the prompt, the model output, SQL, the tool result or any credential.
 */
export function auditLlmAnswer({ result, skipped, actor, deterministicIntent, surface }) {
  try {
    const sfc = surface || (result && result.surface) || (actor && actor.role === "customer" ? "customer" : "admin");
    /* `skipped` covers the enabled-but-not-narratable cases that never reach
       the orchestrator: there is no result to describe, only a reason. */
    const record = skipped
      ? {
          enabled: true,
          provider: "none",
          model: "none",
          surface: sfc,
          role: actor && actor.role ? actor.role : "none",
          selectedTool: null,
          toolArgs: {},
          toolRowCount: null,
          latencyMs: 0,
          success: false,
          errorCode: skipped,
        }
      : result;

    if (!record || !record.enabled) return;

    const parts = [
      "[AI-LLM]",
      `provider=${record.provider}`,
      `model=${record.model || "unset"}`,
      `surface=${record.surface || sfc || "admin"}`,
      `role=${record.role || "none"}`,
      `actorId=${actor && actor.userId !== undefined ? actor.userId : "none"}`,
      `tool=${record.selectedTool || "none"}`,
      `intent=${deterministicIntent || record.intent || "none"}`,
      `argKeys=${Object.keys(record.toolArgs || {}).join("+") || "none"}`,
      `rows=${record.toolRowCount === null || record.toolRowCount === undefined ? "none" : record.toolRowCount}`,
      `latencyMs=${Math.round(record.latencyMs)}`,
      /* Aggregate token counts only. No prompt, completion or usage text. */
      record.usage && record.usage.reported
        ? `tokens=${record.usage.totalTokens}(p${record.usage.promptTokens}/c${record.usage.completionTokens})`
        : "tokens=none",
      `outcome=${record.success ? "success" : "fallback"}`,
    ];
    if (!record.success && record.errorCode) parts.push(`errorCode=${record.errorCode}`);
    if (record.truncated) parts.push("truncated=true");

    if (record.success) console.log(parts.join(" "));
    else console.warn(parts.join(" "));
  } catch {
    /* auditing must never break a request */
  }
}

export { SYSTEM_PROMPT, toJsonSchema };