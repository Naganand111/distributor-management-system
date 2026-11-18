/**
 * Phase 7: deterministic follow-up logic, documented at the route level
 * against the real routers with an in-memory conversation pool.
 *
 * ADMIN covered here:
 *   - follow-up using the previous intent (fresh re-query, viaContext)
 *   - follow-up using the previous data (state selection)
 *   - ambiguous sales follow-up resolved by prior context
 *   - clarification when context is insufficient
 *   - admin identity isolation (another user's history never becomes context)
 *   - this week / last week resolve to the new deterministic tools
 *   - a revenue follow-up can shift to last week
 *   - explicit arbitrary dates remain refused/clarified
 *
 * CUSTOMER covered here (current safe behaviour, unchanged):
 *   - first / second / last order references and pronoun follow-ups
 *   - follow-ups answer from the previous data (items)
 *   - follow-ups stay customer-scoped (identity binding)
 *   - another customer's conversation cannot become focusOrderId
 *   - admin topics remain out of scope and call no admin tool
 *   - viaContext stays deterministic; no LLM narration for context turns
 *
 * Run: node --test tests/ai.followups.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import registerAi from "../routes/ai.js";
import registerCustomerAi from "../routes/customerAi.js";

/* This file asserts deterministic answers, so the LLM layer is pinned off
   for every test except the one that explicitly turns it on. */
process.env.LLM_ENABLED = "false";

/* ------------------------------------------------------------------ *
 * In-memory conversation pool: faithful stand-in for the two tables.
 * ------------------------------------------------------------------ */

const ORDER_ROWS = [
  { id: 301, status: "delivered", payment_status: "paid", total_amount: 1500, discount: 0, created_at: "2026-10-01", item_count: 2, invoice_no: "INV-301" },
  { id: 300, status: "pending", payment_status: "unpaid", total_amount: 900, discount: 0, created_at: "2026-09-28", item_count: 1, invoice_no: null },
  { id: 299, status: "delivered", payment_status: "paid", total_amount: 450, discount: 50, created_at: "2026-09-20", item_count: 3, invoice_no: "INV-299" },
];

const ITEM_ROWS = [
  { order_id: 301, name: "Widget", quantity: 2, price: 50 },
  { order_id: 300, name: "Gadget", quantity: 1, price: 120 },
];

/* Kitchen-sink row: single-row admin aggregates read fields off row 0. */
const KITCHEN = [{ orders: 6, revenue: 9000, count: 6, customers: 2, low_stock: 5, reorder_items: 0, name: "Widget", stock: 2 }];

const customerResponder = (sql) => {
  if (/FROM orders\b/.test(sql)) return ORDER_ROWS;
  if (/FROM order_items/.test(sql)) return ITEM_ROWS;
  return KITCHEN;
};

function conversationPool(responder = () => KITCHEN) {
  const state = { conversations: [], messages: [], nextConv: 900 };
  const calls = [];

  return {
    state,
    calls,
    businessCalls: () => calls.filter((c) => !/ai_conversations|ai_messages/.test(c.sql)),
    seedConversation(id, userId) {
      state.conversations.push({ id, userId });
      return id;
    },
    seedMessage(convId, message) {
      state.messages.push({ convId, ...message });
    },
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

      if (/INSERT INTO ai_conversations/.test(text)) {
        const conv = { id: ++state.nextConv, userId: Number(params[0]) };
        state.conversations.push(conv);
        return [{ insertId: conv.id, affectedRows: 1 }, []];
      }

      if (/INSERT INTO ai_messages/.test(text)) {
        const convId = Number(params[0]);
        const role = /'user'/.test(text) ? "user" : "assistant";
        state.messages.push({ convId, role, content: params[1], meta: params[2] });
        return [{ insertId: state.messages.length, affectedRows: 1 }, []];
      }

      if (/FROM ai_messages/.test(text)) {
        /* Emulate the SQL exactly: conversation_id filter, and for the
           customer route the JOIN on c.user_id as well (params[1]). */
        const convId = Number(params[0]);
        const owner = state.conversations.find((c) => c.id === convId);
        const userId = params.length > 1 ? Number(params[1]) : null;
        const scoped = owner && (userId === null || owner.userId === userId);
        const rows = scoped
          ? state.messages
              .filter((m) => m.convId === convId)
              .map((m) => ({ role: m.role, content: m.content, meta: m.meta }))
              .reverse() /* ORDER BY id DESC */
          : [];
        return [rows, []];
      }

      if (/UPDATE ai_conversations/.test(text)) {
        return [{ affectedRows: 1 }, []];
      }

      return [responder(text, params) || [], []];
    },
  };
}

/* ------------------------------------------------------------------ *
 * Route harness
 * ------------------------------------------------------------------ */

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
  registerAi(
    app,
    pool,
    (req, _res, next) => {
      req.user = user;
      next();
    },
    (_q, _res, next) => next()
  );
  return listen(app);
}

async function mountCustomer(pool, user = { id: 42, role: "customer" }) {
  const app = express();
  app.use(express.json());
  registerCustomerAi(app, pool, (req, _res, next) => {
    req.user = user;
    next();
  });
  return listen(app);
}

async function post(base, path, body) {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const askAdmin = (base, message, conversationId) =>
  post(base, "/api/ai/query", { message, ...(conversationId ? { conversationId } : {}) });

const askCustomer = (base, message, conversationId) =>
  post(base, "/api/customer-ai/query", { message, ...(conversationId ? { conversationId } : {}) });

/* ------------------------------------------------------------------ *
 * ADMIN follow-ups
 * ------------------------------------------------------------------ */

test("A1 admin follow-up uses the previous intent and re-runs the tool fresh", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const first = await askAdmin(base, "top products");
    assert.equal(first.status, 200);
    assert.equal(first.body.data.intent, "top_products");
    assert.ok(first.body.data.data, "the tool must have returned data");
    const convId = first.body.data.conversationId;
    assert.equal(pool.businessCalls().length, 1, "turn 1 runs exactly one tool query");

    const second = await askAdmin(base, "show me those", convId);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.intent, "top_products", "the previous intent is replayed");
    assert.ok(second.body.data.data, "the follow-up re-queries fresh data");
    assert.equal(second.body.data.conversationId, convId, "same conversation");
    assert.equal(
      pool.businessCalls().length,
      2,
      "an admin follow-up re-executes the tool instead of trusting stale context"
    );
  } finally {
    await close();
  }
});

test("A2 admin follow-up uses the previous data to choose a related report", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const first = await askAdmin(base, "how is inventory");
    assert.equal(first.body.data.intent, "inventory_health");
    const convId = first.body.data.conversationId;

    /* The previous result reports low stock > 0, so the follow-up resolves
       to low_stock from context data rather than guessing. */
    const second = await askAdmin(base, "which products are affected?", convId);
    assert.equal(second.body.data.intent, "low_stock");
    assert.ok(second.body.data.data, "the selected follow-up report executed");
  } finally {
    await close();
  }
});

test("A3 an ambiguous sales follow-up resolves to the previous revenue report", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const first = await askAdmin(base, "what is the total revenue");
    assert.equal(first.body.data.intent, "total_revenue");
    const convId = first.body.data.conversationId;

    /* Bare "how are sales" is ambiguous on its own; with prior revenue
       context it deterministically resolves back to that report. */
    const second = await askAdmin(base, "how are sales?", convId);
    assert.equal(second.body.data.intent, "total_revenue");
    assert.ok(second.body.data.answer.includes("total recorded revenue"));
    assert.equal(second.body.data.source, "orders.total_amount", "revenue disclosure survives the follow-up");
  } finally {
    await close();
  }
});

test("A4 an ambiguous first message with no context asks for clarification and runs no tool", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const first = await askAdmin(base, "how are sales");
    assert.equal(first.status, 200);
    assert.equal(first.body.data.intent, "clarification");
    assert.equal(first.body.data.data.needsClarification, true);
    assert.ok(first.body.data.answer.includes("Would you like today's sales"));
    assert.equal(pool.businessCalls().length, 0, "a clarification executes no tool");
  } finally {
    await close();
  }
});

test("A5 admin identity isolation: another user's conversation never becomes context", async () => {
  const pool = conversationPool();
  const foreign = pool.seedConversation(500, 99);
  pool.seedMessage(foreign, {
    role: "assistant",
    content: "previous answer",
    meta: JSON.stringify({ intent: "total_revenue", data: { orders: 6, revenue: 9000 } }),
  });
  const { base, close } = await mountAdmin(pool, { id: 7, role: "admin" });
  try {
    const response = await askAdmin(base, "show me those", foreign);
    assert.equal(response.status, 200);
    assert.notEqual(response.body.data.conversationId, foreign, "the foreign id is discarded");
    assert.equal(response.body.data.intent, "fallback", "no foreign context leaks into routing");
    assert.ok(response.body.data.answer.includes("I can help you with sales and revenue"));

    const ownership = pool.calls.find((c) => /SELECT id FROM ai_conversations/.test(c.sql));
    assert.deepEqual(ownership.params, [foreign, 7], "ownership is checked with the caller's id");

    const foreignReads = pool.calls.filter(
      (c) => /FROM ai_messages/.test(c.sql) && Number(c.params[0]) === foreign
    );
    assert.equal(foreignReads.length, 0, "another user's history is never read");
  } finally {
    await close();
  }
});

test("A6 explicit arbitrary dates remain refused with clarification and no tool", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base, "show me sales from 2026-01-05");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.intent, "clarification");
    assert.equal(response.body.data.data.needsClarification, true);
    assert.ok(response.body.data.answer.includes("don't cover arbitrary dates"));
    assert.equal(pool.businessCalls().length, 0, "an explicit date never reaches a tool");
  } finally {
    await close();
  }
});

test("A7 'this week' and 'last week' resolve to the new deterministic admin tools", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const thisWeek = await askAdmin(base, "how are sales this week");
    assert.equal(thisWeek.status, 200);
    assert.equal(thisWeek.body.data.intent, "this_week_sales");
    assert.ok(thisWeek.body.data.answer.includes("So far this week"));
    assert.equal(thisWeek.body.data.source, "orders.total_amount", "revenue disclosure applies");

    const lastWeek = await askAdmin(base, "sales last week");
    assert.equal(lastWeek.status, 200);
    assert.equal(lastWeek.body.data.intent, "last_week_sales");
    assert.ok(lastWeek.body.data.answer.includes("Last week you had"));
    assert.equal(lastWeek.body.data.source, "orders.total_amount");

    const weekSql = pool
      .businessCalls()
      .map((c) => c.sql)
      .filter((sql) => /WEEKDAY\(CURDATE\(\)\)/.test(sql));
    assert.equal(weekSql.length, 2, "both week queries ran with server-side calendar SQL");
    for (const sql of weekSql) {
      assert.ok(!/\d{4}-\d{2}-\d{2}/.test(sql), "no literal date may appear in week SQL");
    }
  } finally {
    await close();
  }
});

test("A8 a revenue follow-up can shift to last week deterministically", async () => {
  const pool = conversationPool();
  const { base, close } = await mountAdmin(pool);
  try {
    const first = await askAdmin(base, "what is the total revenue");
    assert.equal(first.body.data.intent, "total_revenue");

    const second = await askAdmin(base, "what about last week?", first.body.data.conversationId);
    assert.equal(second.body.data.intent, "last_week_sales");
    assert.ok(second.body.data.answer.includes("Last week"));
    const weekCall = pool.businessCalls().find((c) => /WEEKDAY\(CURDATE\(\)\)/.test(c.sql));
    assert.ok(weekCall, "the follow-up executed the week tool");
  } finally {
    await close();
  }
});

/* ------------------------------------------------------------------ *
 * CUSTOMER follow-ups — documenting the CURRENT safe behaviour
 * ------------------------------------------------------------------ */

test("C1 customer first/second/last order references and pronouns resolve deterministically", async () => {
  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    assert.equal(first.status, 200);
    assert.equal(first.body.data.intent, "my_orders");
    const convId = first.body.data.conversationId;

    const second = await askCustomer(base, "how much was the second one?", convId);
    assert.equal(second.body.data.intent, "my_orders");
    assert.ok(second.body.data.answer.includes("Order #300 came to"), "second -> orders[1]");
    assert.equal(second.body.data.focusOrderId, 300, "the follow-up focuses the second order");

    const pronoun = await askCustomer(base, "how much was it?", convId);
    assert.ok(pronoun.body.data.answer.includes("Order #300 came to"), "pronoun keeps the focused order");
    assert.equal(pronoun.body.data.focusOrderId, 300);

    const last = await askCustomer(base, "how much was the last one?", convId);
    assert.ok(last.body.data.answer.includes("Order #299 came to"), "last -> orders[length-1]");
    assert.equal(last.body.data.focusOrderId, 299);

    const firstRef = await askCustomer(base, "how much was the first one?", convId);
    assert.ok(firstRef.body.data.answer.includes("Order #301 came to"), "first -> orders[0]");
    assert.equal(firstRef.body.data.focusOrderId, 301);

    /* Every business read stayed bound to the caller. */
    for (const call of pool.businessCalls()) {
      if (/FROM orders\b/.test(call.sql)) {
        assert.ok(call.sql.includes("o.user_id=?"), "orders query binds the caller");
        assert.equal(call.params[0], 42, "orders query reads only the caller's rows");
      }
    }
  } finally {
    await close();
  }
});

test("C2 a customer follow-up answers from the previous data (items), without a new tool run", async () => {
  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my recent purchases");
    assert.equal(first.body.data.intent, "recent_purchases");
    const convId = first.body.data.conversationId;
    const queriesAfterTurn1 = pool.businessCalls().length;
    assert.ok(queriesAfterTurn1 >= 2, "orders + items were fetched on turn 1");

    const second = await askCustomer(base, "what did i order?", convId);
    assert.equal(second.body.data.intent, "recent_purchases");
    assert.ok(second.body.data.answer.includes("Order #301 includes:"), "answered from previous data");
    assert.ok(second.body.data.answer.includes("Widget"), "item lines come from the previous result");
    assert.equal(
      pool.businessCalls().length,
      queriesAfterTurn1,
      "the viaContext turn performs no new business query"
    );
  } finally {
    await close();
  }
});

test("C3 customer follow-ups stay customer-scoped on every read", async () => {
  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    const convId = first.body.data.conversationId;
    await askCustomer(base, "how much was the second one?", convId);

    const contextRead = pool.calls.find((c) => /FROM ai_messages m/.test(c.sql));
    assert.ok(contextRead, "the route read conversation context");
    assert.deepEqual(contextRead.params, [convId, 42], "context read is bound to the caller's id");

    for (const call of pool.businessCalls()) {
      if (/FROM orders\b/.test(call.sql)) {
        assert.equal(call.params[0], 42, "every orders read is bound to the caller's id");
      }
    }
  } finally {
    await close();
  }
});

test("C4 another customer's conversation cannot become focusOrderId", async () => {
  const pool = conversationPool(customerResponder);
  const a = await mountCustomer(pool, { id: 42, role: "customer" });
  const b = await mountCustomer(pool, { id: 43, role: "customer" });
  try {
    const first = await askCustomer(a.base, "show my orders");
    const foreignConv = first.body.data.conversationId;
    assert.equal(pool.businessCalls().length, 1);

    const stolen = await askCustomer(
      b.base,
      "how much was the second one?",
      foreignConv
    );

    assert.equal(stolen.status, 200);
    assert.notEqual(stolen.body.data.conversationId, foreignConv, "the foreign conversation is refused");
    assert.equal(stolen.body.data.focusOrderId, null, "no foreign order can become the focus");
    assert.ok(
      stolen.body.data.answer.includes("I can help with your orders"),
      "with no in-scope context the customer gets the safe fallback"
    );
    assert.ok(!/Order #/.test(stolen.body.data.answer), "no foreign order details leak");

    const foreignContextReads = pool.calls.filter(
      (c) => /FROM ai_messages m/.test(c.sql) && Number(c.params[0]) === Number(foreignConv)
    );
    assert.ok(
      foreignContextReads.every((c) => Number(c.params[1]) === 42),
      "the context JOIN is always bound to an in-scope user id"
    );
    assert.ok(
      foreignContextReads.every((c) => Number(c.params[1]) !== 43),
      "user 43 never reads user 42's history"
    );
    assert.equal(pool.businessCalls().length, 1, "the refused follow-up runs no new tool");
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});

test("C5 admin topics stay out of scope as follow-ups and call no admin tool", async () => {
  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    const convId = first.body.data.conversationId;
    const queriesAfterTurn1 = pool.businessCalls().length;

    const second = await askCustomer(base, "what is the company revenue?", convId);
    assert.equal(second.body.data.intent, "out_of_scope");
    assert.equal(second.body.data.data, null);
    assert.equal(
      second.body.data.answer,
      "I can help with information related to your account, orders, payments and purchases."
    );
    assert.equal(
      pool.businessCalls().length,
      queriesAfterTurn1,
      "an out-of-scope follow-up never reaches an admin tool"
    );
  } finally {
    await close();
  }
});

test("C6 viaContext stays deterministic while direct customer turns may narrate", async () => {
  const saved = {
    LLM_ENABLED: process.env.LLM_ENABLED,
    LLM_PROVIDER: process.env.LLM_PROVIDER,
    LLM_MODEL: process.env.LLM_MODEL,
  };
  process.env.LLM_ENABLED = "true";
  process.env.LLM_PROVIDER = "mock";
  process.env.LLM_MODEL = "mock-deterministic";

  const pool = conversationPool(customerResponder);
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    assert.equal(first.body.data.intent, "my_orders");
    assert.ok(
      first.body.data.answer.includes("The tool returned"),
      "the direct turn narrated through the (mock) provider"
    );
    const convId = first.body.data.conversationId;

    const followUp = await askCustomer(base, "how much was the second one?", convId);
    assert.ok(
      !followUp.body.data.answer.includes("The tool returned"),
      "a viaContext turn is never passed to the provider"
    );
    assert.ok(
      followUp.body.data.answer.includes("Order #300 came to"),
      "the viaContext answer stays the deterministic narration"
    );
  } finally {
    await close();
    if (saved.LLM_ENABLED === undefined) delete process.env.LLM_ENABLED;
    else process.env.LLM_ENABLED = saved.LLM_ENABLED;
    if (saved.LLM_PROVIDER === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = saved.LLM_PROVIDER;
    if (saved.LLM_MODEL === undefined) delete process.env.LLM_MODEL;
    else process.env.LLM_MODEL = saved.LLM_MODEL;
  }
});
