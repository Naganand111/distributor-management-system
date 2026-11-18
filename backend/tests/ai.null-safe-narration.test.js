/**
 * Phase 9 Step 6 (L1-L3): user-visible narration must stay clean when the
 * underlying rows are missing or partially populated.
 *
 *   L1  my_order_summary with no / partial summary row uses the safe answer
 *   L2  NULL / blank order-item name, quantity and price get plain labels
 *   L3  NULL / blank Admin customer and sales-rep names get fallback labels
 *
 * No schema, SQL, authorization or live-provider behaviour is exercised here;
 * these tests drive the real routers with in-memory pools and LLM disabled.
 *
 * Run: node --test tests/ai.null-safe-narration.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import registerAi from "../routes/ai.js";
import registerCustomerAi from "../routes/customerAi.js";

process.env.LLM_ENABLED = "false";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, "..");

const SUMMARY_SAFE = "I could not load your order summary just now. Please try asking again.";

/* ------------------------------------------------------------------ *
 * Pools
 * ------------------------------------------------------------------ */

/** Minimal conversation store plus a caller-supplied business responder. */
function poolFor(responder) {
  const state = { conversations: [], messages: [], next: 900, nextMessage: 1, calls: [] };
  return {
    state,
    async query(sql, params = []) {
      const text = String(sql);
      state.calls.push({ sql: text, params });

      if (/SELECT id FROM ai_conversations WHERE id=\? AND user_id=\?/.test(text)) {
        const owned = state.conversations.some(
          (c) => c.id === Number(params[0]) && c.userId === Number(params[1])
        );
        return [owned ? [{ id: Number(params[0]) }] : [], []];
      }
      if (/INSERT INTO ai_conversations/.test(text)) {
        const conv = { id: ++state.next, userId: Number(params[0]) };
        state.conversations.push(conv);
        return [{ insertId: conv.id, affectedRows: 1 }, []];
      }
      if (/INSERT INTO ai_messages/.test(text)) {
        const role = /'user'/.test(text) ? "user" : "assistant";
        state.messages.push({
          id: state.nextMessage++,
          conversation_id: Number(params[0]),
          role,
          content: params[1],
          meta: params[2] ?? null,
        });
        return [{ affectedRows: 1 }, []];
      }
      if (/FROM ai_messages/.test(text)) {
        const rows = state.messages
          .filter((m) => m.conversation_id === Number(params[0]))
          .sort((a, b) => b.id - a.id)
          .map((m) => ({ role: m.role, content: m.content, meta: m.meta }));
        return [rows, []];
      }
      if (/UPDATE ai_conversations/.test(text)) return [{ affectedRows: 1 }, []];
      return [responder(text, params) || [], []];
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

async function mountCustomer(pool) {
  const app = express();
  app.use(express.json());
  registerCustomerAi(app, pool, (req, _res, next) => {
    req.user = { id: 42, role: "customer" };
    next();
  });
  return listen(app);
}

async function mountAdmin(pool) {
  const app = express();
  app.use(express.json());
  registerAi(
    app,
    pool,
    (req, _res, next) => { req.user = { id: 7, role: "admin" }; next(); },
    (_q, _res, next) => next()
  );
  return listen(app);
}

const askCustomer = (base, message, conversationId) =>
  fetch(`${base}/api/customer-ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  }).then((r) => r.json());

const askAdmin = (base, message) =>
  fetch(`${base}/api/ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  }).then((r) => r.json());

const ORDER_ROW = {
  id: 301,
  status: "delivered",
  payment_status: "paid",
  total_amount: 1500,
  discount: 0,
  created_at: "2026-10-01",
  item_count: 1,
  invoice_no: null,
};

const NULL_ITEM = { name: null, quantity: null, price: null };
const VALID_ITEM = { name: "Widget", quantity: 2, price: 250 };

function orderItemResponder(items, orders = [ORDER_ROW]) {
  return (sql) => {
    if (/FROM orders\b/.test(sql)) return orders;
    if (/FROM order_items\b/.test(sql)) return items;
    if (/FROM order_status_history\b/.test(sql)) return [];
    return [];
  };
}

function assertClean(text, allowZero = false) {
  assert.ok(!/\b(?:null|undefined|NaN)\b/i.test(text), `no nullish token in: ${text}`);
  if (!allowZero) {
    assert.ok(!text.includes("₹0.00"), `no fabricated zero price in: ${text}`);
  }
}

/* ================================================================ *
 * L1 — my_order_summary guard
 * ================================================================ */

test("L1 a missing summary row reaches the safe answer, not 'Total orders: undefined'", async () => {
  const pool = poolFor((sql) => {
    if (/COUNT\(\*\) AS total_orders/.test(sql)) return [];
    return [];
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "how many orders do I have");
    assert.equal(response.data.intent, "my_order_summary");
    assert.equal(response.data.answer, SUMMARY_SAFE);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L1 a partial summary object is also guarded", async () => {
  const pool = poolFor((sql) => {
    if (/COUNT\(\*\) AS total_orders/.test(sql)) return [{ total_orders: 3, pending: 1 }];
    return [];
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "how many orders do I have");
    assert.equal(response.data.answer, SUMMARY_SAFE);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L1 a genuine all-zero summary keeps the normal answer", async () => {
  const pool = poolFor((sql) => {
    if (/COUNT\(\*\) AS total_orders/.test(sql)) {
      return [{
        total_orders: 0, pending: 0, processing: 0, shipped: 0,
        delivered: 0, cancelled: 0, total_spent: 0, last_order_at: null,
      }];
    }
    return [];
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "how many orders do I have");
    assert.ok(response.data.answer.startsWith("Here is a summary of your orders:"));
    assert.ok(response.data.answer.includes("Total orders: 0"));
    assert.ok(response.data.answer.includes("Total spent: ₹0.00"));
    assertClean(response.data.answer, true);
  } finally {
    await close();
  }
});

test("L1 source pin: the guard precedes the rendered summary fields", () => {
  const source = fs.readFileSync(path.join(BACKEND, "routes", "customerAi.js"), "utf8");
  const branch = source.slice(
    source.indexOf('if (intent === "my_order_summary")'),
    source.indexOf('if (intent === "my_profile")')
  );
  assert.ok(branch.length > 0, "the my_order_summary branch exists");
  assert.ok(branch.includes("missingData"), "missing data is detected explicitly");
  assert.ok(branch.includes(SUMMARY_SAFE), "the safe answer is returned from that branch");
  const guard = branch.indexOf("if (missingData)");
  const render = branch.indexOf("${s.total_orders}");
  assert.ok(guard !== -1 && render !== -1 && guard < render, "the guard runs before rendering");
});

/* ================================================================ *
 * L2 — nullable order-item fields
 * ================================================================ */

test("L2 track_order renders plain labels for NULL item fields", async () => {
  const pool = poolFor(orderItemResponder([NULL_ITEM]));
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my latest order");
    assert.equal(response.data.intent, "track_order");
    const answer = response.data.answer;
    assert.ok(answer.includes("• Unnamed item — qty unavailable × price unavailable"), answer);
    assertClean(answer);
  } finally {
    await close();
  }
});

test("L2 recent_purchases renders a plain quantity label for a NULL item", async () => {
  const pool = poolFor(orderItemResponder([{ ...NULL_ITEM, order_id: 301 }], [ORDER_ROW]));
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my recent purchases");
    assert.equal(response.data.intent, "recent_purchases");
    assert.ok(response.data.answer.includes("Unnamed item (qty unavailable)"), response.data.answer);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L2 a follow-up item list also renders plain labels", async () => {
  const pool = poolFor(orderItemResponder([NULL_ITEM]));
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my latest order");
    assert.equal(first.data.intent, "track_order");
    const second = await askCustomer(base, "what items did I order?", first.data.conversationId);
    assert.ok(second.data.answer.includes("Unnamed item — qty unavailable × price unavailable"), second.data.answer);
    assertClean(second.data.answer);
  } finally {
    await close();
  }
});

test("L2 fully populated items keep the exact previous wording", async () => {
  const pool = poolFor(orderItemResponder([VALID_ITEM]));
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my latest order");
    assert.ok(response.data.answer.includes("• Widget — 2 × ₹250.00"), response.data.answer);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

/* ================================================================ *
 * L3 — Admin customer / sales-rep fallback labels
 * ================================================================ */

const adminResponder = (rows) => (sql) => {
  if (/FROM orders o\s+JOIN users u/i.test(sql)) return rows;
  if (/FROM orders o\s+JOIN sales_representatives sr/i.test(sql)) return rows;
  if (/top_customer_name|top_customer_orders/.test(sql)) return rows;
  return [];
};

test("L3 top_retailers uses a fallback for null and blank customer names", async () => {
  const pool = poolFor(adminResponder([
    { name: null, total: 900 },
    { name: "   ", total: 500 },
  ]));
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base,"show my top customers");
    assert.equal(response.data.intent, "top_retailers");
    assert.ok(response.data.answer.includes("1. Unnamed customer — ₹900.00"), response.data.answer);
    assert.ok(response.data.answer.includes("2. Unnamed customer — ₹500.00"), response.data.answer);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L3 sales_rep_performance uses a fallback for a blank representative name", async () => {
  const pool = poolFor(adminResponder([{ name: "", orders: 4, revenue: 750 }]));
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base,"sales rep performance");
    assert.equal(response.data.intent, "sales_rep_performance");
    assert.ok(
      response.data.answer.includes("1. Unnamed sales representative — 4 orders — ₹750.00 revenue"),
      response.data.answer
    );
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L3 customer_overview uses a fallback for a blank top-customer name", async () => {
  const pool = poolFor((sql) => {
    if (/COALESCE\(NULLIF\(o\.customer_name/.test(sql)) {
      return [{ name: "  ", orders: 2, spend: 600 }];
    }
    if (/AS total_customers/.test(sql)) {
      return [{
        total_customers: 3,
        customers_with_orders: 2,
        this_month_customers: 1,
        new_customers_this_month: 1,
        lifetime_revenue: 600,
      }];
    }
    return [];
  });
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base,"customer overview");
    assert.equal(response.data.intent, "customer_overview");
    assert.ok(
      response.data.answer.includes("Highest-spending customer: Unnamed customer — 2 orders worth ₹600.00."),
      response.data.answer
    );
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});

test("L3 populated Admin names are rendered verbatim", async () => {
  const pool = poolFor(adminResponder([{ name: "Acme Corp", total: 900 }]));
  const { base, close } = await mountAdmin(pool);
  try {
    const response = await askAdmin(base,"show my top customers");
    assert.ok(response.data.answer.includes("1. Acme Corp — ₹900.00"), response.data.answer);
    assertClean(response.data.answer);
  } finally {
    await close();
  }
});
