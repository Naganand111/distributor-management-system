/**
 * The only sanctioned way for an AI tool to touch the database.
 *
 * Every statement must be a read-only SELECT/WITH. This is a second line of
 * defence: tool contracts already declare `readOnly: true`, and this guard
 * refuses to execute anything that could write even if a tool were wrong.
 */

import { TOOL_ERROR_CODES, ToolError } from "./errors.js";

const ALLOWED_START = /^(SELECT|WITH)\b/i;

/** Statements that mutate data or schema, even if they start with SELECT. */
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|CALL|EXECUTE|LOAD_FILE|HANDLER|INSTALL|UNINSTALL)\b/i;
const FORBIDDEN_WRITE_CLAUSE = /\bINTO\s+(OUTFILE|DUMPFILE)\b/i;

function assertReadOnlyStatement(sql) {
  const statement = String(sql).trim();

  if (!ALLOWED_START.test(statement)) {
    throw new ToolError(TOOL_ERROR_CODES.FORBIDDEN_ARGUMENT, 400, {
      detail: "AI tools may only run read-only SELECT statements",
      statementHead: statement.slice(0, 40),
    });
  }
  if (FORBIDDEN_SQL.test(statement)) {
    throw new ToolError(TOOL_ERROR_CODES.FORBIDDEN_ARGUMENT, 400, {
      detail: "AI tools may not run statements that modify data",
    });
  }
  if (FORBIDDEN_WRITE_CLAUSE.test(statement)) {
    throw new ToolError(TOOL_ERROR_CODES.FORBIDDEN_ARGUMENT, 400, {
      detail: "AI tools may not write query output to the filesystem",
    });
  }
  return statement;
}

/**
 * Run a parameterised read-only query.
 *
 * @param {import("mysql2/promise").Pool} db
 * @param {string} sql         Hand-written, constant SQL. Never caller input.
 * @param {Array}  [params]    Bound values. Values are always bound, never interpolated.
 * @returns {Promise<Array>}   Result rows.
 */
export async function select(db, sql, params = []) {
  const statement = assertReadOnlyStatement(sql);

  if (!db || typeof db.query !== "function") {
    throw new ToolError(TOOL_ERROR_CODES.TOOL_FAILURE, 500, {
      detail: "AI tool received no usable database handle",
    });
  }

  const result = await db.query(statement, Array.isArray(params) ? params : [params]);
  return Array.isArray(result) ? result[0] : result;
}

/** Run a query expected to produce a single aggregate row. */
export async function firstRow(db, sql, params = []) {
  const rows = await select(db, sql, params);
  return rows.length ? rows[0] : undefined;
}

/** Run a query expected to produce a row list. */
export function allRows(db, sql, params = []) {
  return select(db, sql, params);
}