/**
 * Shared constants for the AI tool layer.
 */

/** Roles the AI layer recognises. Any other role is denied by default. */
export const AI_ROLE = Object.freeze({
  ADMIN: "admin",
  CUSTOMER: "customer",
});

/** Roles explicitly known but not granted AI tool access. */
export const AI_DENIED_ROLES = Object.freeze(["sales_rep", "delivery"]);

/** Row caps. Admin may inspect more rows than a customer. */
export const MAX_ROWS = Object.freeze({
  [AI_ROLE.ADMIN]: 50,
  [AI_ROLE.CUSTOMER]: 20,
});

/**
 * Customer-facing row cap. The existing customer assistant already limits
 * list results to at most 10 rows, and this tool layer will not raise it.
 */
export const CUSTOMER_HISTORY_MAX_ROWS = 10;

/** Keys an AI tool argument may never contain. */
export const FORBIDDEN_ARG_KEYS = Object.freeze([
  "sql",
  "query",
  "raw",
  "rawsql",
  "statement",
  "table",
  "tables",
  "tablename",
  "column",
  "columns",
  "field",
  "fields",
  "join",
  "where",
  "whereclause",
  "predicate",
  "having",
  "orderby",
  "groupby",
  "order",
  "sort",
  "limitraw",
  "offsetraw",
  "db",
  "database",
  "connection",
  "pool",
  "host",
  "user_id",
  "userid",
  "customer_id",
  "customerid",
  "owner_id",
  "email",
  "username",
  "password",
  "role",
  "actor",
  "identity",
  "secrets",
  "token",
  "key",
]);

/**
 * Field names whose values must never be returned to a client.
 * Matched case-insensitively against returned object keys.
 */
export const SECRET_FIELD_KEYS = Object.freeze([
  "password",
  "passwordhash",
  "passwd",
  "pwd",
  "hash",
  "token",
  "refreshtoken",
  "accesstoken",
  "jwt",
  "secret",
  "clientsecret",
  "apikey",
  "privatekey",
  "salt",
  "otp",
  "otpcode",
  "otp_hash",
  "cvv",
  "cardnumber",
  "accountnumber",
  "ifsc",
  "upi_id",
  "credential",
  "authorization",
]);

/** Message copied from the existing assistant so behaviour does not shift. */
export const FORBIDDEN_KEY_MESSAGE =
  "That request cannot be answered because it asks for information the assistant will not provide.";