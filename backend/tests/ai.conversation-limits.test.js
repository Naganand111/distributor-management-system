/**
 * Phase 9 Step 5 (M3): conversation message history must be bounded.
 *
 * Both message endpoints read only the newest 100 rows (via a subquery) and
 * then order them chronologically, so the client sees the same shape/order for
 * ordinary conversations while a very large one can no longer produce an
 * unbounded response. Ownership checks and the customer scoping JOIN stay in
 * place, and the Admin query uses explicit columns instead of SELECT *.
 *
 *   A1  Admin empty conversation returns 200 [] with a bounded query
 *   A2  Admin normal conversation returns all rows in chronological order
 *   A3  Admin >100 messages returns only the latest 100, chronological
 *   A4  Admin cannot read another user's history
 *   C1  Customer empty conversation keeps the existing 404 behaviour
 *   C2  Customer normal conversation returns all rows, meta preserved
 *   C3  Customer >100 messages returns only the latest 100, chronological
 *   C4  Customer cannot read another customer's history
 *   S1  SQL shape: latest-100 subquery, no SELECT *, explicit columns
 *
 * Run: node --test tests/ai.conversation-limits.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import registerAi from "../routes/ai.js";
import registerCustomerAi from "../routes/customerAi.js";

/* ------------------------------------------------------------------ *
 * Pool that simulates the ORDER BY … LIMIT semantics of the subquery so
 * the route's cap — not the mock's convenience — is what the tests exercise.
 * ------------------------------------------------------------------ */

function historyPool() {
  const state = { conversations: [], messages: [], nextId: 1 };
  const calls = [];

  return {
    state,
    calls,
    seedConversation(id, userId) {
      state.conversations.push({ id, userId });
    },
    seedMessage(convId, role, content, meta = null) {
      const id = state.nextId++;
      state.messages.push({
        id,
        convId,
        role,
        content,
        meta: meta === null ? null : JSON.stringify(meta),
        created_at: `2026-01-01T00:00:${String(id).padStart(2, "0")}Z`,
      });
      return id;
    },
    historyQueries: () => calls.filter((c) => /FROM ai_messages/.test(c.sql) && !/COUNT\(\*\)/.test(c.sql)),

    async query(sql, params = []) {
      const text = String(sql);
      calls.push({ sql: text, params });

      if (/SELECT id FROM ai_conversations WHERE id=\? AND user_id=\?/.test(text)) {
        const [id, userId] = params;
        const owned = state.conversations.some(
          (c) => c.id === Number(id) && c.userId === Number(userId)
        );
        return [owned ? [{ id: Number(id) }] : [], []];
      }

      if (/FROM ai_messages/.test(text) && !/COUNT\(\*\)/.test(text)) {
        const convId = Number(params[0]);
        const userId = params.length > 1 ? Number(params[1]) : null;
        const owner = state.conversations.find((c) => c.id === convId);
        const scoped = owner && (userId === null || owner.userId === userId);
        if (!scoped) return [[], []];

        let rows = state.messages
          .filter((m) => m.convId === convId)
          .map((m) => ({ ...m, conversation_id: m.convId }))
          .sort((a, b) => a.id - b.id);

        /* The route takes the latest 100 in the inner query, then orders them
           chronologically in the outer query — both are already simulated by
           the ascending sort plus this tail slice. */
        if (/LIMIT\s+100\b/i.test(text)) rows = rows.slice(-100);
        return [rows, []];
      }

      return [[], []];
    },
  };
}

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function mountAdmin(pool, user = { id: 7, role: "admin" }) {
  const app = express();
  app.use(express.json());
  registerAi(app, pool, (req, _res, next) => { req.user = user; next(); }, (_q, _res, next) => next());
  return listen(app);
}

async function mountCustomer(pool, user = { id: 42, role: "customer" }) {
  const app = express();
  app.use(express.json());
  registerCustomerAi(app, pool, (req, _res, next) => { req.user = user; next(); });
  return listen(app);
}

const getMessages = (base, path) =>
  fetch(`${base}${path}`).then((r) => r.json().then((body) => ({ status: r.status, body })));

function seed(pool, convId, userId, count) {
  pool.seedConversation(convId, userId);
  const ids = [];
  for (let i = 0; i < count; i += 1) {
    ids.push(pool.seedMessage(convId, i % 2 ? "assistant" : "user", `msg-${i + 1}`, { intent: "demo", data: {} }));
  }
  return ids;
}

/* ================================================================ *
 * Admin
 * ================================================================ */

test("A1 Admin empty conversation returns 200 [] with a bounded history query", async () => {
  const pool = historyPool();
  pool.seedConversation(100, 7);
  const { base, close } = await mountAdmin(pool);
  try {
    const res = await getMessages(base, "/api/ai/conversations/100/messages");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, []);
    assert.equal(pool.historyQueries().length, 1);
    assert.match(pool.historyQueries()[0].sql, /LIMIT\s+100/);
  } finally {
    await close();
  }
});

test("A2 Admin normal conversation returns every row in chronological order with meta", async () => {
  const pool = historyPool();
  const ids = seed(pool, 100, 7, 5);
  const { base, close } = await mountAdmin(pool);
  try {
    const res = await getMessages(base, "/api/ai/conversations/100/messages");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 5);
    assert.deepEqual(res.body.map((m) => m.id), ids, "oldest first");
    assert.deepEqual(res.body.map((m) => m.content), ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"]);
    for (const row of res.body) {
      assert.ok("meta" in row, "the frontend-required meta field is preserved");
      assert.ok("role" in row && "content" in row && "created_at" in row);
    }
  } finally {
    await close();
  }
});

test("A3 Admin conversation with 130 messages returns the latest 100, chronologically", async () => {
  const pool = historyPool();
  const ids = seed(pool, 100, 7, 130);
  const { base, close } = await mountAdmin(pool);
  try {
    const res = await getMessages(base, "/api/ai/conversations/100/messages");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 100, "the response is capped");
    assert.deepEqual(res.body.map((m) => m.id), ids.slice(30), "the newest 100 rows are kept");
    assert.equal(res.body[0].content, "msg-31");
    assert.equal(res.body.at(-1).content, "msg-130");
    assert.deepEqual(
      res.body.map((m) => m.id),
      [...res.body.map((m) => m.id)].sort((a, b) => a - b),
      "chronological order is preserved"
    );
  } finally {
    await close();
  }
});

test("A4 Admin cannot read another user's conversation history", async () => {
  const pool = historyPool();
  seed(pool, 100, 7, 3);
  seed(pool, 200, 8, 3);
  const { base, close } = await mountAdmin(pool, { id: 7, role: "admin" });
  try {
    const before = pool.historyQueries().length;
    const res = await getMessages(base, "/api/ai/conversations/200/messages");
    assert.equal(res.status, 404);
    assert.equal(pool.historyQueries().length, before, "no history query is issued for a foreign conversation");
  } finally {
    await close();
  }
});

/* ================================================================ *
 * Customer
 * ================================================================ */

test("C1 Customer empty conversation keeps the existing 404 behaviour", async () => {
  const pool = historyPool();
  pool.seedConversation(300, 42);
  const { base, close } = await mountCustomer(pool);
  try {
    const res = await getMessages(base, "/api/customer-ai/conversations/300/messages");
    assert.equal(res.status, 404);
  } finally {
    await close();
  }
});

test("C2 Customer normal conversation returns every row, meta preserved", async () => {
  const pool = historyPool();
  const ids = seed(pool, 300, 42, 6);
  const { base, close } = await mountCustomer(pool);
  try {
    const res = await getMessages(base, "/api/customer-ai/conversations/300/messages");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 6);
    assert.deepEqual(res.body.map((m) => m.id), ids, "oldest first");
    for (const row of res.body) {
      assert.ok("meta" in row, "meta survives the bounded query");
    }
    assert.match(pool.historyQueries()[0].sql, /c\.user_id=\?/, "the ownership JOIN is preserved");
  } finally {
    await close();
  }
});

test("C3 Customer conversation with 130 messages returns the latest 100, chronologically", async () => {
  const pool = historyPool();
  const ids = seed(pool, 300, 42, 130);
  const { base, close } = await mountCustomer(pool);
  try {
    const res = await getMessages(base, "/api/customer-ai/conversations/300/messages");
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 100, "the response is capped");
    assert.deepEqual(res.body.map((m) => m.id), ids.slice(30));
    assert.equal(res.body[0].content, "msg-31");
    assert.equal(res.body.at(-1).content, "msg-130");
  } finally {
    await close();
  }
});

test("C4 Customer cannot read another customer's history", async () => {
  const pool = historyPool();
  seed(pool, 300, 42, 3);
  seed(pool, 301, 43, 3);
  const { base, close } = await mountCustomer(pool, { id: 42, role: "customer" });
  try {
    const before = pool.historyQueries().length;
    const res = await getMessages(base, "/api/customer-ai/conversations/301/messages");
    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: "Conversation not found" }, "no foreign content leaks");
    const issued = pool.historyQueries().slice(before);
    assert.equal(issued.length, 1, "the scoped JOIN query is issued");
    assert.equal(Number(issued[0].params[1]), 42, "it is bound to the caller's id");
    assert.match(issued[0].sql, /c\.user_id=\?/, "ownership is enforced inside the query");
  } finally {
    await close();
  }
});

/* ================================================================ *
 * SQL shape
 * ================================================================ */

test("S1 bounded SQL uses a latest-100 subquery and explicit columns", async () => {
  const pool = historyPool();
  seed(pool, 100, 7, 2);
  seed(pool, 300, 42, 2);
  const admin = await mountAdmin(pool);
  const customer = await mountCustomer(pool);
  try {
    await getMessages(admin.base, "/api/ai/conversations/100/messages");
    await getMessages(customer.base, "/api/customer-ai/conversations/300/messages");
  } finally {
    await admin.close();
    await customer.close();
  }

  const queries = pool.historyQueries().map((c) => c.sql);
  assert.equal(queries.length, 2);

  const adminSql = queries[0];
  assert.ok(!/SELECT\s+\*/i.test(adminSql), "Admin no longer uses SELECT *");
  assert.match(adminSql, /FROM\s*\(\s*SELECT/i, "Admin uses a subquery");
  assert.match(adminSql, /LIMIT\s+100\b/i);
  for (const column of ["id", "conversation_id", "role", "content", "meta", "created_at"]) {
    assert.match(adminSql, new RegExp(`recent\\.${column}\\b`), `Admin selects known column ${column}`);
  }

  const customerSql = queries[1];
  assert.ok(!/SELECT\s+\*/i.test(customerSql), "Customer uses explicit columns");
  assert.match(customerSql, /FROM\s*\(\s*SELECT/i, "Customer uses a subquery");
  assert.match(customerSql, /LIMIT\s+100\b/i);
  assert.match(customerSql, /c\.user_id=\?/, "customer scoping is inside the subquery");
});
