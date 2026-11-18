/**
 * Structured audit logging for AI tool execution.
 *
 * Metadata only: never argument values, SQL, message text, credentials or
 * stack traces. Callers pass argument *keys* so the log proves what shape of
 * input was accepted without recording customer or business data.
 */

function formatMeta(meta) {
  const parts = [];
  if (meta.tool) parts.push(`tool=${meta.tool}`);
  if (meta.intent) parts.push(`intent=${meta.intent}`);
  if (meta.actorId !== undefined && meta.actorId !== null) parts.push(`actorId=${meta.actorId}`);
  if (meta.role) parts.push(`role=${meta.role}`);
  if (Array.isArray(meta.argKeys)) {
    parts.push(`argKeys=${meta.argKeys.length ? meta.argKeys.join("+") : "none"}`);
  }
  if (meta.rowCount !== undefined && meta.rowCount !== null) parts.push(`rows=${meta.rowCount}`);
  if (typeof meta.durationMs === "number") parts.push(`durationMs=${meta.durationMs}`);
  parts.push(`outcome=${meta.outcome}`);
  if (meta.errorCode) parts.push(`errorCode=${meta.errorCode}`);
  return parts.join(" ");
}

function write(level, meta, message) {
  const line = `[AI-AUDIT] ${formatMeta(meta)}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/**
 * Record one tool call.
 *
 * @param {object} meta
 * @param {string} meta.tool            registered tool name
 * @param {string} [meta.intent]        detected intent the tool served
 * @param {number} [meta.actorId]       authenticated user id
 * @param {string} [meta.role]          authenticated role
 * @param {string[]} [meta.argKeys]     validated argument *names* only
 * @param {number|null} [meta.rowCount] rows returned
 * @param {number} [meta.durationMs]    wall-clock duration
 * @param {"success"|"failure"} meta.outcome
 * @param {string} [meta.errorCode]     safe error code, never a raw message
 */
export function auditToolCall(meta) {
  try {
    if (meta && meta.outcome === "failure") {
      write("warn", meta, `tool ${meta.tool} failed`);
    } else {
      write("log", meta, `tool ${meta.tool} completed`);
    }
  } catch {
    /* auditing must never break a request */
  }
}

/**
 * Record a request that was refused before execution (bad role, unknown tool,
 * bad arguments). No duration is known yet.
 */
export function auditRefusal(meta) {
  try {
    write("warn", { ...meta, outcome: "refused" }, `tool ${meta.tool} refused`);
  } catch {
    /* ignore */
  }
}