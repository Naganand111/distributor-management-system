/**
 * Declarative argument validation, output shaping and secret redaction.
 *
 * Schema fields:
 *   type      "int" | "enum" | "date" | "string" | "boolean"
 *   required  boolean
 *   default   value used when the argument is absent
 *   min/max   numeric bounds (int)
 *   values    allowed values (enum)
 *   pattern   RegExp source the string must match
 *   maxLength string length cap
 */

import {
  FORBIDDEN_ARG_KEYS,
  SECRET_FIELD_KEYS,
} from "./constants.js";
import {
  forbiddenArgument,
  invalidArgument,
  missingArgument,
  outputShape,
  unknownArgument,
} from "./errors.js";

const FORBIDDEN = new Set(FORBIDDEN_ARG_KEYS);
const SECRETS = new Set(SECRET_FIELD_KEYS);

/** Reject any argument key the tool never asked for. */
export function assertNoForbiddenKeys(args) {
  for (const key of Object.keys(args)) {
    const normalised = key.toLowerCase().replace(/[\s_-]/g, "");
    if (FORBIDDEN.has(key.toLowerCase()) || FORBIDDEN.has(normalised)) {
      throw forbiddenArgument(`argument "${key}" is not accepted`);
    }
  }
}

function coerceInt(name, spec, value) {
  let num = value;
  if (typeof num === "string") {
    if (!/^-?\d+$/.test(num.trim())) {
      throw invalidArgument(`argument "${name}" must be a whole number`);
    }
    num = Number(num.trim());
  }
  if (typeof num !== "number" || !Number.isInteger(num)) {
    throw invalidArgument(`argument "${name}" must be a whole number`);
  }
  if (spec.min !== undefined && num < spec.min) {
    throw invalidArgument(`argument "${name}" is below the allowed minimum of ${spec.min}`);
  }
  if (spec.max !== undefined && num > spec.max) {
    throw invalidArgument(`argument "${name}" is above the allowed maximum of ${spec.max}`);
  }
  return num;
}

function coerceEnum(name, spec, value) {
  if (typeof value !== "string" || !spec.values.includes(value)) {
    throw invalidArgument(`argument "${name}" must be one of: ${spec.values.join(", ")}`);
  }
  return value;
}

function coerceDate(name, spec, value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw invalidArgument(`argument "${name}" is not a valid date`);
    }
    return value;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    throw invalidArgument(`argument "${name}" must be an ISO date (YYYY-MM-DD)`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalidArgument(`argument "${name}" is not a valid date`);
  }
  return parsed;
}

function coerceString(name, spec, value) {
  if (typeof value !== "string") {
    throw invalidArgument(`argument "${name}" must be a string`);
  }
  const cap = spec.maxLength ?? 120;
  if (value.length > cap) {
    throw invalidArgument(`argument "${name}" is longer than the allowed ${cap} characters`);
  }
  if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
    throw invalidArgument(`argument "${name}" has an unsupported format`);
  }
  return value;
}

function coerceBoolean(name, spec, value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalidArgument(`argument "${name}" must be true or false`);
}

/**
 * Validate and narrow caller-supplied arguments against a tool's schema.
 * Unknown keys are rejected so a tool can never be handed surprise input.
 */
export function validateArgs(inputSchema, args) {
  const source = args && typeof args === "object" && !Array.isArray(args) ? args : {};

  assertNoForbiddenKeys(source);

  const schemaKeys = Object.keys(inputSchema);
  for (const key of Object.keys(source)) {
    if (!schemaKeys.includes(key)) {
      throw unknownArgument(`argument "${key}" is not declared by this tool`);
    }
  }

  const validated = {};
  for (const [name, spec] of Object.entries(inputSchema)) {
    const provided = Object.prototype.hasOwnProperty.call(source, name);
    const value = source[name];

    // A default applies only when the caller genuinely omitted the argument.
    // An explicit null is a caller bug and is rejected rather than guessed at.
    if (!provided || value === undefined) {
      if (spec.default !== undefined) {
        validated[name] = spec.default;
      } else if (spec.required) {
        throw missingArgument(`argument "${name}" is required`);
      }
      continue;
    }
    if (value === null) {
      throw invalidArgument(`argument "${name}" may not be null`);
    }
    switch (spec.type) {
      case "int":
        validated[name] = coerceInt(name, spec, value);
        break;
      case "enum":
        validated[name] = coerceEnum(name, spec, value);
        break;
      case "date":
        validated[name] = coerceDate(name, spec, value);
        break;
      case "string":
        validated[name] = coerceString(name, spec, value);
        break;
      case "boolean":
        validated[name] = coerceBoolean(name, spec, value);
        break;
      default:
        throw invalidArgument(`argument "${name}" has an unsupported schema type`);
    }
  }

  return validated;
}

/** Remove secret-named fields anywhere in a returned structure. */
export function redactSecrets(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    return value.map((entry) => redactSecrets(entry, depth + 1));
  }

  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  if (typeof value === "object") {
    const cleaned = {};
    for (const [key, entry] of Object.entries(value)) {
      if (SECRETS.has(key.toLowerCase().replace(/[\s_-]/g, ""))) continue;
      cleaned[key] = redactSecrets(entry, depth + 1);
    }
    return cleaned;
  }

  return value;
}

/** Number of rows a tool returned, for auditing and row-cap enforcement. */
export function countRows(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const key of ["orders", "payments", "invoices", "rows", "records", "items"]) {
      if (Array.isArray(data[key])) return data[key].length;
    }
    /* A flat object is a single aggregate row, not an unknown count. Reporting
       it keeps the audit honest about how much the model was shown. */
    return 1;
  }
  return null;
}

/**
 * Shape a tool result for the client: cap rows, redact secrets, drop
 * undefined so the payload matches what the routes produced before.
 */
export function shapeResult(result, maxRows) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw outputShape("tool result must be an object");
  }
  if (!("data" in result)) {
    throw outputShape('tool result must contain a "data" field');
  }

  const limit = typeof maxRows === "number" ? maxRows : null;
  const shaped = {};

  for (const [key, value] of Object.entries(result)) {
    if (value === undefined) continue;

    if (Array.isArray(value)) {
      shaped[key] = limit !== null ? value.slice(0, limit) : value;
    } else if (value !== null && typeof value === "object" && !(value instanceof Date) && !Buffer.isBuffer(value)) {
      shaped[key] = shapeNested(value, limit, 1);
    } else {
      shaped[key] = value;
    }
  }

  // Redact secrets in place. `undefined` fields are dropped, matching what
  // JSON.stringify would have done to the pre-tool-layer payload, so an
  // aggregate query that returns no rows still serialises identically.
  return redactSecrets(shaped);
}

function shapeNested(value, limit, depth) {
  if (depth > 4) return value;

  if (Array.isArray(value)) {
    const capped = limit !== null ? value.slice(0, limit) : value;
    return capped.map((entry) =>
      entry !== null && typeof entry === "object" && !(entry instanceof Date)
        ? shapeNested(entry, limit, depth + 1)
        : entry
    );
  }

  if (value instanceof Date || Buffer.isBuffer(value)) return value;

  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) continue;
    if (Array.isArray(entry)) {
      out[key] = limit !== null ? entry.slice(0, limit) : entry;
    } else if (entry !== null && typeof entry === "object" && !(entry instanceof Date) && !Buffer.isBuffer(entry)) {
      out[key] = shapeNested(entry, limit, depth + 1);
    } else {
      out[key] = entry;
    }
  }
  return out;
}