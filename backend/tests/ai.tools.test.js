/**
 * Phase 1 AI tool layer tests.
 *
 * Run: npm test   (node --test, no external test dependency)
 *
 * These cover the security contract: default deny, role isolation, customer
 * ownership, argument validation, read-only SQL, row caps, redaction, safe
 * errors and audit hygiene.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { aiRegistry, AI_TOOLS } from "../services/ai/index.js";
import { FORBIDDEN_ARG_KEYS, MAX_ROWS } from "../services/ai/constants.js";
import { select } from "../services/ai/db.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOOL_DIR = path.join(HERE, "..", "services", "ai", "tools");

/** The 36 Admin intents the assistant already served. */
const ADMIN_INTENTS = [
  "business_summary", "business_alerts", "inventory_health", "daily_performance",
  "monthly_performance", "sales_trend", "customer_overview", "business_recommendations",
  "product_overview", "payment_overview", "order_overview", "todays_sales",
  "yesterday_sales", "this_week_sales", "last_week_sales", "todays_customers",
  "total_customers", "total_revenue", "this_month_revenue", "last_month_revenue",
  "compare_months", "low_stock", "top_products", "slow_products", "inventory_value",
  "pending_orders", "cancelled_orders", "todays_orders", "total_orders", "top_retailers",
  "gross_profit", "overdue", "sales_rep_performance", "reorder", "expired", "damaged",
];

/** The 7 Customer intents the assistant already served. */
const CUSTOMER_INTENTS = [
  "my_orders", "track_order", "my_payments", "my_invoices",
  "recent_purchases", "my_order_summary", "my_profile",
];

const ADMIN = AI_TOOLS.filter((t) => t.allowedRoles.includes("admin"));
const CUSTOMER = AI_TOOLS.filter((t) => t.allowedRoles.includes("customer"));

/** Recording mock pool. `responder` maps (sql, params) -> rows. */
function mockDb(responder) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return [responder ? responder(sql, params) || [] : [], []];
    },
  };
}

/** Assert a promise rejects with a specific ToolError code. */
async function rejectsWithCode(fn, code, message) {
  await assert.rejects(
    fn,
    (err) => {
      assert.equal(err.code, code, `${message}: expected code ${code}, got ${err.code} (${err.message})`);
      return true;
    },
    message
  );
}

const db = mockDb();
const adminActor = { userId: 1, role: "admin" };
const customerActor = { userId: 7, role: "customer" };

/* ------------------------------------------------------------------ *
 * 1-3  Registry integrity
 * ------------------------------------------------------------------ */

test("1. every existing Admin intent maps to exactly one registered tool", () => {
  for (const intent of ADMIN_INTENTS) {
    const name = aiRegistry.toolNameForIntent(intent);
    assert.ok(name, `admin intent "${intent}" has no tool`);
    const tool = aiRegistry.get(name);
    assert.equal(tool.intent, intent);
    assert.deepEqual(tool.allowedRoles, ["admin"], `${intent} must be admin-only`);
  }
  assert.equal(ADMIN.length, 36);
  // No stray admin tools beyond the 36 known intents.
  assert.deepEqual(ADMIN.map((t) => t.intent).sort(), [...ADMIN_INTENTS].sort());
});

test("2. every existing Customer intent maps to exactly one registered tool", () => {
  for (const intent of CUSTOMER_INTENTS) {
    const name = aiRegistry.toolNameForIntent(intent);
    assert.ok(name, `customer intent "${intent}" has no tool`);
    const tool = aiRegistry.get(name);
    assert.equal(tool.intent, intent);
    assert.deepEqual(tool.allowedRoles, ["customer"], `${intent} must be customer-only`);
  }
  assert.equal(CUSTOMER.length, 7);
});

test("3. every registered tool declares a complete, read-only contract", () => {
  for (const tool of AI_TOOLS) {
    assert.equal(tool.readOnly, true, `${tool.name} must declare readOnly: true`);
    assert.equal(typeof tool.description, "string");
    assert.ok(tool.description.length >= 10, `${tool.name} needs a real description`);
    assert.equal(typeof tool.inputSchema, "object");
    assert.equal(typeof tool.run, "function");
    assert.ok(Number.isInteger(tool.maxRows) && tool.maxRows >= 1, `${tool.name} maxRows`);
  }
});

/* ------------------------------------------------------------------ *
 * 4-7  Admin authorisation
 * ------------------------------------------------------------------ */

test("4. Admin tools execute for role admin", async () => {
  // Single-row aggregates are what these tools actually receive, so the
  // fixture returns one row per statement.
  const oneRow = mockDb(() => [{ count: 1, revenue: 1, cost: 1, value: 1, n: 1 }]);

  for (const tool of ADMIN) {
    const result = await aiRegistry.execute({
      toolName: tool.name,
      actor: adminActor,
      db: oneRow,
      args: {},
    });
    assert.ok(result && typeof result === "object", `${tool.name} returned no payload`);
    if ("data" in result) {
      assert.ok(result.data === null || typeof result.data === "object", `${tool.name} returned a non-object data field`);
    }
  }

  // A row list tool that matches nothing yields no data key at all, exactly
  // as it did before the tool layer existed. That must not throw either.
  const emptyDb = mockDb(() => []);
  const emptyResult = await aiRegistry.execute({
    toolName: "count_total_orders",
    actor: adminActor,
    db: emptyDb,
    args: {},
  });
  assert.deepEqual(emptyResult, {}, "an empty aggregate should serialise as it always did");

  // With rows present the payload carries them through untouched.
  const populated = mockDb(() => [{ count: 7 }]);
  const withRows = await aiRegistry.execute({
    toolName: "count_total_orders",
    actor: adminActor,
    db: populated,
    args: {},
  });
  assert.deepEqual(withRows.data, { count: 7 });
});

test("5. Admin tools are denied for role customer", async () => {
  for (const tool of ADMIN) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: { userId: 7, role: "customer" }, db, args: {} }),
      "forbidden_role",
      `${tool.name} must refuse a customer`
    );
  }
});

test("6. Admin tools are denied for roles sales_rep and delivery", async () => {
  for (const tool of ADMIN) {
    for (const role of ["sales_rep", "delivery"]) {
      await rejectsWithCode(
        () => aiRegistry.execute({ toolName: tool.name, actor: { userId: 3, role }, db, args: {} }),
        "forbidden_role",
        `${tool.name} must refuse ${role}`
      );
    }
  }
});

test("7. authorisation happens before any database call", async () => {
  const tripwire = mockDb(() => {
    throw new Error("database must not be reached");
  });
  await rejectsWithCode(
    () => aiRegistry.execute({ toolName: ADMIN[0].name, actor: { userId: 3, role: "sales_rep" }, db: tripwire }),
    "forbidden_role"
  );
  assert.equal(tripwire.calls.length, 0, "a denied call reached the database");
});

/* ------------------------------------------------------------------ *
 * 8-9  Customer authorisation
 * ------------------------------------------------------------------ */

test("8. Customer tools execute for role customer", async () => {
  for (const tool of CUSTOMER) {
    const result = await aiRegistry.execute({
      toolName: tool.name,
      actor: customerActor,
      db,
      args: {},
    });
    assert.ok("data" in result, `${tool.name} returned no data field`);
  }
});

test("9. Customer tools are denied for role admin", async () => {
  for (const tool of CUSTOMER) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: { userId: 1, role: "admin" }, db, args: {} }),
      "forbidden_role",
      `${tool.name} must refuse an admin`
    );
  }
});

/* ------------------------------------------------------------------ *
 * 10-13  No caller-controlled SQL, no forbidden arguments
 * ------------------------------------------------------------------ */

test("10. no tool interpolates a validated argument into its SQL", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) files.push(full);
    }
  };
  walk(TOOL_DIR);

  assert.ok(files.length >= 5, "expected to find the tool source files");
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.ok(!/\$\{args\b/.test(src), `${file} interpolates an argument into SQL`);
    assert.ok(!/\$\{args\./.test(src), `${file} interpolates an argument into SQL`);
  }
});

test("11. Admin tools accept no caller-supplied identifiers at all", () => {
  for (const tool of ADMIN) {
    assert.deepEqual(tool.inputSchema, {}, `${tool.name} must take no arguments`);
  }
  for (const tool of AI_TOOLS) {
    for (const key of Object.keys(tool.inputSchema)) {
      const normalised = key.toLowerCase().replace(/[\s_-]/g, "");
      for (const banned of FORBIDDEN_ARG_KEYS) {
        assert.ok(
          key.toLowerCase() !== banned && normalised !== banned,
          `${tool.name} declares forbidden argument "${key}"`
        );
      }
    }
  }
});

test("12. forbidden arguments (SQL, identifiers, identity) are rejected", async () => {
  const tool = CUSTOMER.find((t) => t.intent === "my_orders");
  for (const bad of [
    { sql: "SELECT 1" }, { query: "SELECT 1" }, { table: "users" }, { column: "password" },
    { where: "1=1" }, { order_by: "password" }, { user_id: 99 }, { customer_id: 99 },
    { email: "a@b.c" }, { username: "root" }, { role: "admin" }, { db: "mysql" },
    { pool: "x" }, { password: "x" }, { token: "x" }, { offset_raw: 5 },
  ]) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: customerActor, db, args: bad }),
      "forbidden_argument",
      `args ${JSON.stringify(bad)} must be refused`
    );
  }
});

test("13. unknown arguments are rejected", async () => {
  const tool = CUSTOMER.find((t) => t.intent === "my_orders");
  for (const bad of [{ limit: 3, colour: "red" }, { sortBy: "name" }, { depth: 2 }]) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: customerActor, db, args: bad }),
      "unknown_argument",
      `args ${JSON.stringify(bad)} must be refused`
    );
  }
});

/* ------------------------------------------------------------------ *
 * 14-16  Validation ranges and enums
 * ------------------------------------------------------------------ */

test("14. out-of-range limits are rejected", async () => {
  const tool = CUSTOMER.find((t) => t.intent === "my_orders");
  for (const limit of [0, -1, 11, 999, 1.5, "5; DROP TABLE orders", "abc", null, {}, []]) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: customerActor, db, args: { limit } }),
      "invalid_argument",
      `limit ${JSON.stringify(limit)} must be refused`
    );
  }
  // The boundaries the assistant already advertised still work.
  for (const limit of [1, 10]) {
    const r = await aiRegistry.execute({ toolName: tool.name, actor: customerActor, db, args: { limit } });
    assert.equal(r.data.limit, limit);
  }
});

test("15. an invalid period enum is rejected and valid periods map to server-side SQL", async () => {
  const tool = CUSTOMER.find((t) => t.intent === "my_orders");
  for (const period of ["all_time", "2020-01-01", "", "today; DROP TABLE orders", 7]) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: tool.name, actor: customerActor, db, args: { period } }),
      "invalid_argument",
      `period ${JSON.stringify(period)} must be refused`
    );
  }

  const recorder = mockDb(() => []);
  await aiRegistry.execute({ toolName: tool.name, actor: customerActor, db: recorder, args: { period: "last_month" } });
  const sql = recorder.calls[0].sql;
  assert.ok(sql.includes("INTERVAL 1 MONTH"), "period enum did not select the expected server-side fragment");
  assert.ok(!sql.includes("last_month"), "the raw enum leaked into SQL");
  // The only quoted literals are the server-side date formats; no caller value
  // ever reaches the statement.
  const literals = sql.match(/'[^']*'/g) || [];
  for (const literal of literals) {
    assert.ok(/^'%Y-%m-01'$/.test(literal), `unexpected literal in SQL: ${literal}`);
  }
  assert.equal(recorder.calls[0].params[0], 7, "the period was bound instead of interpolated");
});

test("16. row caps are enforced and cannot be raised by a contract", () => {
  for (const tool of ADMIN) {
    assert.ok(tool.maxRows <= MAX_ROWS.admin, `${tool.name} exceeds the admin cap`);
  }
  for (const tool of CUSTOMER) {
    assert.ok(tool.maxRows <= MAX_ROWS.customer, `${tool.name} exceeds the customer cap`);
  }
  assert.equal(MAX_ROWS.admin, 50);
  assert.equal(MAX_ROWS.customer, 20);
});

test("17. oversized result sets are truncated to the tool's row cap", async () => {
  const overCap = mockDb(() => Array.from({ length: 500 }, (_, i) => ({ id: i })));
  const result = await aiRegistry.execute({
    toolName: "list_top_retailers",
    actor: adminActor,
    db: overCap,
    args: {},
  });
  assert.equal(result.data.length, 50, "admin results must cap at 50 rows");
});

/* ------------------------------------------------------------------ *
 * 18  Customer ownership
 * ------------------------------------------------------------------ */

test("18. a customer can only ever read their own rows", async () => {
  for (const tool of CUSTOMER) {
    const recorder = mockDb((sql) => {
      // Only ownership-scoped tools may run a query at all.
      assert.ok(
        /user_id\s*=\s*\?|WHERE\s+id\s*=\s*\?/i.test(sql),
        `${tool.name} executed SQL without an ownership predicate`
      );
      return [];
    });

    await aiRegistry.execute({ toolName: tool.name, actor: { userId: 4242, role: "customer" }, db: recorder, args: {} });

    assert.ok(recorder.calls.length > 0, `${tool.name} ran no query`);
    for (const call of recorder.calls) {
      assert.ok(
        call.params.includes(4242),
        `${tool.name} did not bind the authenticated user id (params: ${JSON.stringify(call.params)})`
      );
      for (const other of [1, 2, 7, 99]) {
        if (other === 4242) continue;
        assert.ok(
          !call.params.includes(other),
          `${tool.name} bound a foreign user id ${other}`
        );
      }
    }
  }
});

test("19. a forged user_id argument can never override the session identity", async () => {
  const tool = CUSTOMER.find((t) => t.intent === "my_profile");
  const recorder = mockDb(() => []);
  await rejectsWithCode(
    () => aiRegistry.execute({ toolName: tool.name, actor: customerActor, db: recorder, args: { user_id: 1 } }),
    "forbidden_argument"
  );
  assert.equal(recorder.calls.length, 0, "the rejected call still reached the database");
});

/* ------------------------------------------------------------------ *
 * 20-22  Safe failures, redaction and auditing
 * ------------------------------------------------------------------ */

test("20. an unknown tool is refused (default deny)", async () => {
  for (const name of ["ghost_tool", "", "../../etc/passwd", "DROP TABLE orders", null, undefined]) {
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: name, actor: adminActor, db }),
      "unknown_tool",
      `tool ${JSON.stringify(name)} must be refused`
    );
  }
  // A registered customer tool is still unreachable by an admin.
  await rejectsWithCode(
    () => aiRegistry.execute({ toolName: "get_my_orders", actor: adminActor, db }),
    "forbidden_role"
  );
});

test("21. database errors are masked and never leak SQL or driver detail", async () => {
  const secretish = "ER_PARSE_ERROR near 'password_hash' in SELECT * FROM users";
  const exploding = mockDb(() => {
    throw new Error(secretish);
  });

  await assert.rejects(
    () => aiRegistry.execute({ toolName: "get_my_orders", actor: customerActor, db: exploding, args: {} }),
    (err) => {
      assert.equal(err.code, "tool_failure");
      assert.equal(err.status, 500);
      assert.ok(!err.message.includes("password_hash"), "error message leaked SQL");
      assert.ok(!err.message.includes("SELECT"), "error message leaked the statement");
      assert.ok(err.detail, "internal detail should be retained for server-side logs only");
      return true;
    }
  );
});

test("22. the read-only guard rejects every statement that could write", async () => {
  const tripwire = mockDb(() => {
    throw new Error("database must not be reached");
  });
  const writes = [
    "DELETE FROM orders", "UPDATE users SET name='x'", "INSERT INTO ai_messages VALUES (1)",
    "DROP TABLE orders", "ALTER TABLE users ADD x INT", "TRUNCATE orders",
    "CREATE TABLE t (id INT)", "GRANT ALL ON *.* TO 'x'", "CALL do_thing()",
    "SELECT * FROM users INTO OUTFILE '/tmp/leak'", "SELECT * FROM users INTO DUMPFILE '/tmp/leak'",
    "SHOW TABLES", "SET @x = 1", "WITH cte AS (DELETE FROM orders RETURNING *) SELECT 1",
    "", "   ", null,
  ];
  for (const sql of writes) {
    await rejectsWithCode(
      () => select(tripwire, sql),
      "forbidden_argument",
      `statement ${JSON.stringify(String(sql).slice(0, 40))} must be refused`
    );
  }
  assert.equal(tripwire.calls.length, 0, "a rejected statement reached the database");
  const rows = await select(mockDb(() => [{ a: 1 }]), "SELECT a FROM t WHERE id=?", [1]);
  assert.deepEqual(rows, [{ a: 1 }]);
});

test("23. secret fields are stripped from tool output", async () => {
  const leaky = mockDb(() => [
    { id: 1, name: "ok", password: "hunter2", password_hash: "abc", passwordHash: "abc" },
  ]);
  const result = await aiRegistry.execute({
    toolName: "get_my_orders",
    actor: customerActor,
    db: leaky,
    args: {},
  });
  const row = result.data.orders[0];
  assert.equal(row.id, 1);
  assert.equal(row.name, "ok");
  for (const banned of ["password", "password_hash", "passwordHash"]) {
    assert.ok(!(banned in row), `${banned} survived redaction`);
  }
});

test("24. audit output records metadata only, never message text, SQL or values", async () => {
  const lines = [];
  const realLog = console.log;
  const realWarn = console.warn;
  console.log = (...a) => lines.push(a.join(" "));
  console.warn = (...a) => lines.push(a.join(" "));

  try {
    const recorder = mockDb(() => [{ total_amount: 987654, customer_note: "CONFIDENTIAL_MARKER" }]);
    await aiRegistry.execute({
      toolName: "get_my_orders",
      intent: "my_orders",
      actor: customerActor,
      db: recorder,
      args: { limit: 4 },
    });
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }

  const audit = lines.filter((l) => l.includes("[AI-AUDIT]"));
  assert.ok(audit.length > 0, "no audit line was written");

  const joined = audit.join("\n");
  assert.ok(joined.includes("tool=get_my_orders"), "audit lost the tool name");
  assert.ok(joined.includes("actorId=7"), "audit lost the actor id");
  assert.ok(joined.includes("role=customer"), "audit lost the role");
  assert.ok(joined.includes("argKeys=limit+period"), "audit lost the argument keys");
  assert.ok(joined.includes("outcome=success"), "audit lost the outcome");

  for (const leak of ["SELECT", "FROM ", "WHERE", "CONFIDENTIAL_MARKER", "987654", "hunter2"]) {
    assert.ok(!joined.includes(leak), `audit log leaked "${leak}"`);
  }
});

test("25. every failing call is audited with a safe code and no raw message", async () => {
  const lines = [];
  const realWarn = console.warn;
  const realLog = console.log;
  console.warn = (...a) => lines.push(a.join(" "));
  console.log = (...a) => lines.push(a.join(" "));

  try {
    await assert.rejects(
      () => aiRegistry.execute({ toolName: "get_my_orders", actor: { userId: 3, role: "sales_rep" }, db }),
      /not allowed/
    );
  } finally {
    console.warn = realWarn;
    console.log = realLog;
  }

  const joined = lines.join("\n");
  assert.ok(joined.includes("[AI-AUDIT]"), "a refused call was not audited");
  assert.ok(joined.includes("errorCode=forbidden_role"), "audit lost the safe error code");
  assert.ok(!/ER_|SELECT|FROM /i.test(joined), "audit leaked database detail");
});