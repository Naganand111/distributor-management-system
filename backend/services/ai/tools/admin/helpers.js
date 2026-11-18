/**
 * Shared admin tool helpers.
 */

export { allRows, firstRow } from "../../db.js";

/** Contract defaults for an admin tool. */
export const ADMIN_TOOL_DEFAULTS = Object.freeze({
  allowedRoles: ["admin"],
  readOnly: true,
  maxRows: 50,
  inputSchema: {},
});