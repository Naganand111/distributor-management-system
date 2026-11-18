/**
 * Phase 7: deterministic date handling.
 *
 * Customer periods gain "yesterday" and the previous CALENDAR week; admin
 * gains this-week / last-week sales through the existing Phase 1 registry.
 *
 * Invariants checked here:
 *   - every existing period keeps its exact meaning, SQL and label,
 *   - dates are computed inside SQL only (CURDATE / WEEKDAY), never from
 *     caller- or model-supplied text,
 *   - the caller's identity binding and row limits stay intact,
 *   - explicit and unknown date phrases remain safe,
 *   - the new admin week tools are admin-only, no-argument, read-only,
 *     parameter-free and row-capped.
 *
 * Run: node --test tests/ai.dates.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { aiRegistry, detectPeriod, PERIODS } from "../services/ai/index.js";
import { PERIOD, PERIOD_NAMES } from "../services/ai/tools/customer/periods.js";

/** Recording mock pool, same convention as ai.tools.test.js. */
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
      assert.equal(
        err.code,
        code,
        `${message}: expected code ${code}, got ${err.code} (${err.message})`
      );
      return true;
    },
    message
  );
}

const customerActor = { userId: 4242, role: "customer" };
const adminActor = { userId: 1, role: "admin" };

const myOrdersTool = () => aiRegistry.get(aiRegistry.toolNameForIntent("my_orders"));

/* ------------------------------------------------------------------ *
 * Customer period detection
 * ------------------------------------------------------------------ */

test("1. detectPeriod maps yesterday phrasings to the yesterday period", () => {
  for (const phrase of [
    "yesterday",
    "what did I order yesterday?",
    "show my orders from yesterday",
    "any orders placed yesterday?",
  ]) {
    assert.equal(detectPeriod(phrase), PERIOD.YESTERDAY, `phrase: ${phrase}`);
  }
});

test("2. detectPeriod maps 'last week' to the previous calendar week, distinct from the rolling 7 days", () => {
  for (const phrase of ["last week", "orders from last week", "previous week", "my orders last week"]) {
    assert.equal(detectPeriod(phrase), PERIOD.LAST_WEEK, `phrase: ${phrase}`);
  }

  /* The rolling phrases keep their existing meaning and must not collide
     with the new calendar-week match. */
  for (const phrase of ["last 7 days", "past week", "this week", "orders in the last 7 days"]) {
    assert.equal(detectPeriod(phrase), PERIOD.LAST_7_DAYS, `phrase: ${phrase}`);
  }
});

test("3. every existing period meaning is unchanged and unknown date phrases stay safe", () => {
  assert.equal(detectPeriod("show my orders today"), PERIOD.TODAY);
  assert.equal(detectPeriod("this morning"), PERIOD.TODAY);
  assert.equal(detectPeriod("this month"), PERIOD.THIS_MONTH);
  assert.equal(detectPeriod("current month"), PERIOD.THIS_MONTH);
  assert.equal(detectPeriod("last month"), PERIOD.LAST_MONTH);

  /* No period mentioned -> all (the existing default). */
  assert.equal(detectPeriod("show my orders"), PERIOD.ALL);

  /* Unknown or explicit date phrases never become a period: they fall back
     to the safe default, still bound to the caller's own rows. */
  for (const phrase of [
    "orders since 2026-01-05",
    "orders on 5/1/2026",
    "orders from 5 oct 2026",
    "orders in january",
    "orders from lastquarter",
  ]) {
    assert.equal(detectPeriod(phrase), PERIOD.ALL, `phrase: ${phrase}`);
  }
});

test("4. every period's SQL and label are pinned (existing unchanged, new ones server-side)", () => {
  assert.deepEqual({ ...PERIODS }, {
    all: { sql: "", label: "" },
    today: { sql: "AND DATE(o.created_at) = CURDATE()", label: "placed today" },
    yesterday: {
      sql: "AND DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)",
      label: "placed yesterday",
    },
    last_7_days: {
      sql: "AND o.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)",
      label: "placed in the last 7 days",
    },
    last_week: {
      sql:
        "AND o.created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY) " +
        "AND o.created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)",
      label: "placed last week",
    },
    this_month: {
      sql: "AND o.created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')",
      label: "placed this month",
    },
    last_month: {
      sql:
        "AND o.created_at >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 1 MONTH), '%Y-%m-01') " +
        "AND o.created_at < DATE_FORMAT(CURDATE(), '%Y-%m-01')",
      label: "placed last month",
    },
  });

  assert.deepEqual(
    [...PERIOD_NAMES],
    ["all", "today", "yesterday", "last_7_days", "last_week", "this_month", "last_month"],
    "the period enum gained the two new names and nothing else"
  );
});

test("5. the last-week SQL bounds spell the previous Monday-Sunday calendar week (model of the SQL)", () => {
  /* Mirrors DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY),
     INTERVAL 7 DAY) < ... < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE())
     DAY), with MySQL WEEKDAY(): Monday = 0 ... Sunday = 6. */
  const at = (iso) => new Date(`${iso}T00:00:00Z`);
  const minus = (d, days) => new Date(d.getTime() - days * 86400000);

  for (const iso of ["2026-10-05" /* Monday */, "2026-10-07" /* Wednesday */, "2026-10-11" /* Sunday */]) {
    const today = at(iso);
    const weekday = (today.getUTCDay() + 6) % 7; // MySQL WEEKDAY()
    const thisMonday = minus(today, weekday);
    const lower = minus(thisMonday, 7); // previous calendar week starts here
    const upper = thisMonday; // ... and ends the day before

    assert.equal((upper - lower) / 86400000, 7, `${iso}: bounds span exactly one week`);
    assert.equal(lower.getUTCDay(), 1, `${iso}: lower bound is a Monday`);
    assert.ok(lower < today, `${iso}: lower bound is in the past`);
    assert.ok(upper <= today, `${iso}: upper bound never includes today`);
  }
});

/* ------------------------------------------------------------------ *
 * Customer period execution: server-side SQL, identity binding, limits
 * ------------------------------------------------------------------ */

test("6. yesterday and last-week periods execute with server-side SQL and stay identity-bound", async () => {
  const recorder = mockDb(() => []);

  await aiRegistry.execute({
    toolName: myOrdersTool().name,
    actor: customerActor,
    db: recorder,
    args: { limit: 10, period: "yesterday" },
  });

  const y = recorder.calls[0];
  assert.ok(
    y.sql.includes("AND DATE(o.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)"),
    "yesterday must select the server-side fragment"
  );
  assert.ok(!/yesterday/i.test(y.sql), "the raw period name leaked into SQL");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(y.sql), "no literal date may appear in SQL");
  assert.deepEqual(y.params, [4242, 10], "identity and limit stay bound parameters");

  const recorder2 = mockDb(() => []);
  await aiRegistry.execute({
    toolName: myOrdersTool().name,
    actor: customerActor,
    db: recorder2,
    args: { limit: 5, period: "last_week" },
  });

  const w = recorder2.calls[0];
  assert.ok(
    w.sql.includes(
      "o.created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)"
    ),
    "last week lower bound is the previous calendar Monday, computed in SQL"
  );
  assert.ok(
    w.sql.includes("o.created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)"),
    "last week upper bound is this calendar Monday, computed in SQL"
  );
  assert.ok(!/last_week/i.test(w.sql), "the raw period name leaked into SQL");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(w.sql), "no literal date may appear in SQL");
  assert.deepEqual(w.params, [4242, 5], "identity and limit stay bound parameters");
});

test("7. new periods keep the customer identity scoping for every caller", async () => {
  const tool = myOrdersTool();
  for (const period of ["yesterday", "last_week", "today", "all"]) {
    for (const actor of [{ userId: 4242, role: "customer" }, { userId: 7777, role: "customer" }]) {
      const recorder = mockDb(() => []);
      await aiRegistry.execute({ toolName: tool.name, actor, db: recorder, args: { limit: 5, period } });
      const { sql, params } = recorder.calls[0];
      assert.ok(sql.includes("o.user_id=?"), `${period}: orders query must bind the caller`);
      assert.equal(params[0], actor.userId, `${period}: params[0] must be the caller's id`);
    }
  }
});

test("8. the model's period enum carries only safe enum names, never dates or SQL", () => {
  const periodSchema = myOrdersTool().inputSchema.period;
  assert.deepEqual([...periodSchema.values], [...PERIOD_NAMES]);
  for (const value of periodSchema.values) {
    assert.match(value, /^[a-z0-9_]+$/, `enum value "${value}" must be a bare name`);
    assert.ok(!/\d{4}-\d{2}/.test(value), `enum value "${value}" looks like a date`);
  }
});

test("9. a caller- or model-supplied date string is rejected as a period", async () => {
  const tool = myOrdersTool();
  for (const period of [
    "2026-01-05",
    "2026-10-08",
    "5/1/2026",
    "oct 5",
    "yesterday; DROP TABLE orders",
    "last week 2026",
  ]) {
    await rejectsWithCode(
      () =>
        aiRegistry.execute({
          toolName: tool.name,
          actor: customerActor,
          db: mockDb(() => []),
          args: { limit: 5, period },
        }),
      "invalid_argument",
      `period ${JSON.stringify(period)} must be refused`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Admin week tools
 * ------------------------------------------------------------------ */

test("10. the admin week tools are registered, admin-only, no-argument and row-capped", async () => {
  for (const intent of ["this_week_sales", "last_week_sales"]) {
    const name = aiRegistry.toolNameForIntent(intent);
    assert.ok(name, `admin intent "${intent}" has no tool`);
    const tool = aiRegistry.get(name);
    assert.equal(tool.intent, intent);
    assert.deepEqual(tool.allowedRoles, ["admin"], `${intent} must be admin-only`);
    assert.equal(tool.readOnly, true, `${intent} must be read-only`);
    assert.deepEqual(tool.inputSchema, {}, `${intent} must take no arguments`);
    assert.ok(
      Number.isInteger(tool.maxRows) && tool.maxRows >= 1 && tool.maxRows <= 50,
      `${intent} maxRows must stay within the established cap`
    );

    /* Any argument (a date, a period, anything) is refused outright. */
    await rejectsWithCode(
      () =>
        aiRegistry.execute({
          toolName: name,
          actor: adminActor,
          db: mockDb(() => []),
          args: { period: "last week" },
        }),
      "unknown_argument",
      `${intent} must accept no caller arguments`
    );

    /* A customer is refused before any database call. */
    const tripwire = mockDb(() => {
      throw new Error("database must not be reached");
    });
    await rejectsWithCode(
      () => aiRegistry.execute({ toolName: name, actor: { userId: 7, role: "customer" }, db: tripwire, args: {} }),
      "forbidden_role",
      `${intent} must refuse a customer`
    );
    assert.equal(tripwire.calls.length, 0, `${intent}: a denied call reached the database`);
  }
});

test("11. admin week SQL is deterministic, parameter-free and carries no date literals", async () => {
  const thisWeek = mockDb(() => [{ orders: 4, revenue: 2500 }]);
  const r1 = await aiRegistry.execute({
    toolName: aiRegistry.toolNameForIntent("this_week_sales"),
    actor: adminActor,
    db: thisWeek,
    args: {},
  });
  assert.deepEqual(r1.data, { orders: 4, revenue: 2500 });

  const thisSql = thisWeek.calls[0].sql;
  assert.match(thisSql.trim(), /^SELECT/i, "read-only statement expected");
  assert.ok(
    thisSql.includes("created_at >= DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)"),
    "this week starts at this calendar Monday, computed in SQL"
  );
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(thisSql), "no literal date may appear in SQL");
  assert.ok(
    !/(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i.test(thisSql),
    "no write statement"
  );
  assert.deepEqual(thisWeek.calls[0].params, [], "the admin week tools bind no parameters");

  const lastWeek = mockDb(() => [{ orders: 7, revenue: 4200 }]);
  await aiRegistry.execute({
    toolName: aiRegistry.toolNameForIntent("last_week_sales"),
    actor: adminActor,
    db: lastWeek,
    args: {},
  });

  const lastSql = lastWeek.calls[0].sql;
  assert.match(lastSql.trim(), /^SELECT/i, "read-only statement expected");
  assert.ok(
    lastSql.includes(
      "created_at >= DATE_SUB(DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY), INTERVAL 7 DAY)"
    ),
    "last week lower bound is the previous calendar Monday"
  );
  assert.ok(
    lastSql.includes("created_at < DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)"),
    "last week upper bound is this calendar Monday"
  );
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(lastSql), "no literal date may appear in SQL");
  assert.deepEqual(lastWeek.calls[0].params, [], "the admin week tools bind no parameters");
});
