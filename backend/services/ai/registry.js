/**
 * Default-deny tool registry.
 *
 * Nothing is reachable unless it was explicitly registered, and a registered
 * tool only runs when the caller's role is on its `allowedRoles` list.
 * Authorisation happens *before* any argument handling or database access.
 */

import { auditRefusal, auditToolCall } from "./audit.js";
import { AI_ROLE, MAX_ROWS } from "./constants.js";
import {
  TOOL_ERROR_CODES,
  ToolError,
  forbiddenRole,
  toSafeToolError,
  unknownTool,
} from "./errors.js";
import { select } from "./db.js";
import {
  countRows,
  shapeResult,
  validateArgs,
} from "./validator.js";

const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const KNOWN_ROLES = new Set(Object.values(AI_ROLE));

/**
 * Tools never receive the raw pool. They get this read-only facade, so even a
 * buggy or careless tool cannot reach a write statement, whatever it calls.
 */
const readOnlyHandles = new WeakMap();

function readOnlyHandle(db) {
  if (!db || typeof db.query !== "function") return db;
  if (readOnlyHandles.has(db)) return readOnlyHandles.get(db);

  const handle = {
    async query(sql, params = []) {
      return [await select(db, sql, params), []];
    },
  };
  readOnlyHandles.set(db, handle);
  return handle;
}

function validateContract(tool) {
  if (!tool || typeof tool !== "object") {
    throw new Error("AI tool contract must be an object");
  }
  if (typeof tool.name !== "string" || !TOOL_NAME_PATTERN.test(tool.name)) {
    throw new Error(`AI tool name must match ${TOOL_NAME_PATTERN} (got ${String(tool.name)})`);
  }
  if (typeof tool.description !== "string" || tool.description.trim().length < 5) {
    throw new Error(`AI tool "${tool.name}" needs a meaningful description`);
  }
  if (tool.intent !== undefined && typeof tool.intent !== "string") {
    throw new Error(`AI tool "${tool.name}" has a non-string intent`);
  }

  if (tool.readOnly !== true) {
    throw new Error(`AI tool "${tool.name}" must declare readOnly: true`);
  }

  if (!Array.isArray(tool.allowedRoles) || tool.allowedRoles.length === 0) {
    throw new Error(`AI tool "${tool.name}" must list at least one allowed role`);
  }
  for (const role of tool.allowedRoles) {
    if (!KNOWN_ROLES.has(role)) {
      throw new Error(`AI tool "${tool.name}" lists unknown role "${role}"`);
    }
  }

  if (typeof tool.maxRows !== "number" || !Number.isInteger(tool.maxRows) || tool.maxRows < 1) {
    throw new Error(`AI tool "${tool.name}" must declare a positive integer maxRows`);
  }
  const roleCap = Math.min(...tool.allowedRoles.map((role) => MAX_ROWS[role]));
  if (tool.maxRows > roleCap) {
    throw new Error(
      `AI tool "${tool.name}" maxRows ${tool.maxRows} exceeds the ${roleCap} row cap for ${tool.allowedRoles.join("/")}`
    );
  }

  if (!tool.inputSchema || typeof tool.inputSchema !== "object" || Array.isArray(tool.inputSchema)) {
    throw new Error(`AI tool "${tool.name}" must declare an inputSchema object`);
  }
  for (const [key, spec] of Object.entries(tool.inputSchema)) {
    if (!spec || typeof spec !== "object" || typeof spec.type !== "string") {
      throw new Error(`AI tool "${tool.name}" argument "${key}" needs a typed schema entry`);
    }
  }

  if (typeof tool.run !== "function") {
    throw new Error(`AI tool "${tool.name}" must implement run()`);
  }
}

export function createToolRegistry(initialTools = []) {
  /** @type {Map<string, object>} */
  const tools = new Map();
  /** @type {Map<string, string>} */
  const byIntent = new Map();

  function register(tool) {
    validateContract(tool);

    if (tools.has(tool.name)) {
      throw new Error(`AI tool "${tool.name}" is already registered`);
    }
    if (tool.intent) {
      if (byIntent.has(tool.intent)) {
        throw new Error(
          `Intent "${tool.intent}" is already served by tool "${byIntent.get(tool.intent)}"`
        );
      }
    }

    tools.set(tool.name, Object.freeze(tool));
    if (tool.intent) byIntent.set(tool.intent, tool.name);
    return tool;
  }

  /** Look up a tool by intent without checking permission. */
  function toolNameForIntent(intent) {
    return byIntent.get(intent) || null;
  }

  /**
   * Default-deny authorisation. Unknown tool or role mismatch throws before
   * arguments are inspected and before any database call.
   */
  function assertAllowed(toolName, role) {
    const tool = tools.get(toolName);
    if (!tool) {
      throw unknownTool(`unknown tool "${toolName}"`);
    }
    if (typeof role !== "string" || role.length === 0) {
      throw forbiddenRole(`tool "${toolName}" called without an authenticated role`);
    }
    if (!tool.allowedRoles.includes(role)) {
      throw forbiddenRole(`role "${role}" may not use tool "${toolName}"`);
    }
    return tool;
  }

  /**
   * Authorise, validate, execute and audit one tool call.
   *
   * @param {object} params
   * @param {string} params.toolName
   * @param {{userId: number|string, role: string}} params.actor
   *        Authenticated caller. Customer tools must use `actor.userId`.
   * @param {object} [params.args]     Validated against the tool's schema.
   * @param {object} params.db          mysql2 pool, used only through `select()`.
   * @param {string} [params.intent]    For auditing only.
   * @returns {Promise<{data: any}>}
   */
  async function execute({ toolName, actor, args = {}, db, intent }) {
    let tool;
    const role = actor && typeof actor === "object" ? actor.role : undefined;

    try {
      tool = assertAllowed(toolName, role);
    } catch (err) {
      const safe = toSafeToolError(err);
      auditRefusal({
        tool: toolName,
        intent,
        actorId: actor && actor.userId,
        role,
        argKeys: [],
        rowCount: null,
        errorCode: safe.code,
      });
      throw safe;
    }

    let validated;
    try {
      validated = validateArgs(tool.inputSchema, args);
    } catch (err) {
      const safe = toSafeToolError(err);
      auditRefusal({
        tool: toolName,
        intent: intent || tool.intent,
        actorId: actor && actor.userId,
        role,
        argKeys: [],
        rowCount: null,
        errorCode: safe.code,
      });
      throw safe;
    }

    const startedAt = process.hrtime.bigint();
    const argKeys = Object.keys(validated);

    try {
      const result = await tool.run({
        db: readOnlyHandle(db),
        actor: { userId: actor.userId, role: actor.role },
        args: validated,
      });

      const shaped = shapeResult(result, tool.maxRows);

      auditToolCall({
        tool: toolName,
        intent: intent || tool.intent,
        actorId: actor.userId,
        role,
        argKeys,
        rowCount: countRows(shaped.data),
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        outcome: "success",
      });

      return shaped;
    } catch (err) {
      const safe = toSafeToolError(err);
      auditToolCall({
        tool: toolName,
        intent: intent || tool.intent,
        actorId: actor.userId,
        role,
        argKeys,
        rowCount: null,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6,
        outcome: "failure",
        errorCode: safe.code,
      });
      throw safe;
    }
  }

  // Registration is validated eagerly so a malformed contract fails at
  // startup rather than at question time.
  for (const tool of initialTools) register(tool);

  return {
    register,
    execute,
    assertAllowed,
    toolNameForIntent,
    get: (toolName) => tools.get(toolName),
    has: (toolName) => tools.has(toolName),
    size: () => tools.size,
    list: () => [...tools.values()],
    listForRole: (role) => [...tools.values()].filter((tool) => tool.allowedRoles.includes(role)),
    intents: () => [...byIntent.keys()],
  };
}

export { TOOL_ERROR_CODES, ToolError };