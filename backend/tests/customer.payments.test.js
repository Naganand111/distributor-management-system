/**
 * Phase 9 Step 3: customer payment narration must never print the literal
 * words "undefined" or "null", or invent zero values, when payment data is
 * missing. The summary fields must be present before they are rendered.
 *
 * Registered through the real customer router with an in-memory conversation
 * pool, so these cover the exact route -> narrate() path (not a mock of it).
 *
 *   P1  valid payment data keeps the existing wording byte-for-byte
 *   P2  a genuine zero-payment result keeps the existing zero-state wording
 *   U1  undefined data via a my_order_summary follow-up returns the safe answer
 *   N1  null data is structurally identical to undefined, pinned at source
 *   N2  a missing summary row takes the guarded path (no partial rendering)
 *   N3  an incomplete summary cannot render "Orders: undefined"
 *   F1  an empty prior-order context follow-up returns the safe answer
 *   I1  two customers isolated: neither answer leaks the other's payments
 *
 * Run: node --test tests/customer.payments.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

import registerCustomerAi from "../routes/customerAi.js";

/* Deterministic answers are asserted throughout; pin the LLM layer off. */
process.env.LLM_ENABLED = "false";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, "..");

const SAFE_ANSWER = "I could not load your payment details just now. Please try asking again.";
const VALID_ANSWER =
  "Payment summary for your account:\n\n" +
  "• Paid: ₹500.00\n• Outstanding: ₹1,000.00\n• Orders: 2\n\n" +
  "Recent payments:\n• ₹500.00 — Upi — order #301 — 02 Oct 2026";
const EMPTY_ANSWER =
  "Payment summary for your account:\n\n" +
  "• Paid: ₹0.00\n• Outstanding: ₹0.00\n• Orders: 0\n\n" +
  "No payment records have been recorded yet.";

/* A local (offset-less) timestamp formats to the same calendar date in any
   server timezone, keeping the exact-wording assertion portable. */
const PAYMENT_ROW = {
  payment_id: 7,
  order_id: 301,
  amount: 500,
  method: "upi",
  note: null,
  payment_date: "2026-10-02T12:00:00",
  invoice_no: "INV-301",
  payment_status: "paid",
};

const VALID_SUMMARY = { paid: 500, outstanding: 1000, orders: 2, pending_orders: 1 };
const EMPTY_SUMMARY = { paid: 0, outstanding: 0, orders: 0, pending_orders: 0 };

function assertNoLiteralNullish(answer) {
  assert.ok(!answer.includes("undefined"), `no "undefined" in: ${answer}`);
  assert.ok(!answer.includes("null"), `no "null" in: ${answer}`);
}

/* ------------------------------------------------------------------ *
 * In-memory conversation pool (same shape the other route suites use)
 * ------------------------------------------------------------------ */

const KITCHEN = [{ orders: 6, revenue: 9000 }];

function conversationPool(responder = () => KITCHEN) {
  const state = { conversations: [], messages: [], nextConv: 900 };
  const calls = [];

  return {
    state,
    calls,
    businessCalls: () => calls.filter((c) => !/ai_conversations|ai_messages/.test(c.sql)),
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
        const convId = Number(params[0]);
        const owner = state.conversations.find((c) => c.id === convId);
        const userId = params.length > 1 ? Number(params[1]) : null;
        const scoped = owner && (userId === null || owner.userId === userId);
        const rows = scoped
          ? state.messages
              .filter((m) => m.convId === convId)
              .map((m) => ({ role: m.role, content: m.content, meta: m.meta }))
              .reverse()
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

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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

const askCustomer = async (base, message, conversationId) => {
  const response = await fetch(`${base}/api/customer-ai/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
    }),
  });
  return { status: response.status, body: await response.json() };
};

/* The real payment tool issues two reads: the payment list, then the summary.
   Match the summary first — it also contains "FROM orders". */
const paymentResponder = ({ list, summary }) => (sql) => {
  if (/COALESCE\(SUM\(o\.paid_amount\)/.test(sql)) return summary;
  if (/FROM payments\b/.test(sql)) return list;
  return KITCHEN;
};

/* ================================================================ */

test("P1 valid payment data keeps the exact existing response wording", async () => {
  const pool = conversationPool(
    paymentResponder({ list: [PAYMENT_ROW], summary: [VALID_SUMMARY] })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my payments");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.intent, "my_payments");
    assert.equal(response.body.data.answer, VALID_ANSWER);
    assert.deepEqual(response.body.data.data.summary, VALID_SUMMARY);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("P2 a genuine zero-payment result keeps the exact existing zero-state wording", async () => {
  const pool = conversationPool(
    paymentResponder({ list: [], summary: [EMPTY_SUMMARY] })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my payments");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.intent, "my_payments");
    assert.equal(response.body.data.answer, EMPTY_ANSWER);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("U1 undefined data via a my_order_summary follow-up returns the safe answer", async () => {
  /* A spending-summary turn has no `orders` array, so followUpAnswer()
     returns null and the route calls narrate("my_payments", undefined). */
  const pool = conversationPool((sql) => {
    if (/COALESCE\(SUM\(o\.paid_amount\)/.test(sql)) return [VALID_SUMMARY];
    if (/FROM payments\b/.test(sql)) return [PAYMENT_ROW];
    if (/FROM orders\b/.test(sql)) return [{ total_orders: 2 }];
    return KITCHEN;
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "how many orders do I have");
    assert.equal(first.body.data.intent, "my_order_summary");
    const convId = first.body.data.conversationId;
    const queriesAfterTurn1 = pool.businessCalls().length;

    const second = await askCustomer(base, "what about payment?", convId);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.intent, "my_payments");
    assert.equal(second.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(second.body.data.answer);
    assert.equal(second.body.data.focusOrderId, null);
    assert.ok(!("data" in second.body.data), "no follow-up data was attached");
    assert.equal(
      pool.businessCalls().length,
      queriesAfterTurn1,
      "the missing-data answer runs no payment tool"
    );
  } finally {
    await close();
  }
});

test("N1 null data is structurally identical to undefined and stays guarded", () => {
  const source = fs.readFileSync(path.join(BACKEND, "routes", "customerAi.js"), "utf8");

  /* narrate() normalises null and undefined identically via `data || {}`, so
     U1/F1 exercise the same runtime branch for both. The route cannot currently
     pass a literal null (followUp carries no data key), so pin the guard
     itself: it must run before the summary count is interpolated. */
  assert.match(source, /function narrate\(intent, data\) \{\s*const d = data \|\| \{\};/);

  const branch = source.slice(
    source.indexOf('if (intent === "my_payments")'),
    source.indexOf('if (intent === "my_invoices")')
  );
  assert.ok(branch.length > 0, "the my_payments branch exists");
  assert.ok(branch.includes("missingData"), "missing data is detected explicitly");
  assert.ok(branch.includes(SAFE_ANSWER), "the safe answer is returned from that branch");
  const guard = branch.indexOf("if (missingData)");
  const render = branch.indexOf("${s.orders}");
  assert.ok(guard !== -1 && render !== -1 && guard < render, "the guard runs before rendering");
});

test("N2 a missing summary row reaches the guarded path without partial rendering", async () => {
  /* firstRow() returns undefined when the summary query yields no row; the
     tools layer drops the undefined `summary` field, so narrate() receives a
     partial object. It must not render "Paid: ₹0.00" / "Orders: undefined". */
  const pool = conversationPool(
    paymentResponder({ list: [], summary: [] })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my payments");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("N3 an incomplete summary cannot render \"Orders: undefined\"", async () => {
  /* A malformed/partial summary that omits `orders` is invalid data, not a
     zero result. It must take the guarded path rather than print "undefined". */
  const pool = conversationPool(
    paymentResponder({ list: [], summary: [{ paid: 0, outstanding: 0 }] })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my payments");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("F1 an empty prior-order context follow-up returns the safe answer", async () => {
  /* Empty prior orders => detectFollowUp() borrows my_payments from context
     with no data; followUpAnswer() has no order to quote, so narrate() is
     reached with undefined. This is the original bug path from the audit. */
  const pool = conversationPool((sql) => {
    if (/FROM orders\b/.test(sql)) return [];
    return KITCHEN;
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    assert.equal(first.body.data.intent, "my_orders");
    assert.ok(Array.isArray(first.body.data.data.orders) && first.body.data.data.orders.length === 0);
    const convId = first.body.data.conversationId;
    const queriesAfterTurn1 = pool.businessCalls().length;

    const second = await askCustomer(base, "what about payment?", convId);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.intent, "my_payments");
    assert.equal(second.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(second.body.data.answer);
    assert.equal(second.body.data.focusOrderId, null, "there is no order to focus on");
    assert.ok(!("data" in second.body.data), "no follow-up data exists — the field is absent");
    assert.equal(
      pool.businessCalls().length,
      queriesAfterTurn1,
      "narrate(intent, undefined) runs no tool"
    );
  } finally {
    await close();
  }
});

test("I1 customers are isolated: no payment data crosses user boundaries", async () => {
  const pool = conversationPool((sql, params) => {
    const owns = Number(params[0]) === 42;
    if (/COALESCE\(SUM\(o\.paid_amount\)/.test(sql)) {
      return [owns ? VALID_SUMMARY : EMPTY_SUMMARY];
    }
    if (/FROM payments\b/.test(sql)) return owns ? [PAYMENT_ROW] : [];
    return KITCHEN;
  });
  const a = await mountCustomer(pool, { id: 42, role: "customer" });
  const b = await mountCustomer(pool, { id: 43, role: "customer" });
  try {
    const answerA = (await askCustomer(a.base, "show my payments")).body.data.answer;
    const answerB = (await askCustomer(b.base, "show my payments")).body.data.answer;

    assert.equal(answerA, VALID_ANSWER, "the owner sees their own payment");
    assert.equal(answerB, EMPTY_ANSWER, "the other customer sees only their own empty state");
    assert.ok(!answerB.includes("INV-301"), "no foreign invoice number leaks");
    assert.ok(!answerB.includes("₹1,000.00"), "no foreign outstanding total leaks");
    assert.ok(!answerB.includes("Upi"), "no foreign payment method leaks");
    assertNoLiteralNullish(answerA);
    assertNoLiteralNullish(answerB);

    const reads = pool.businessCalls().filter((c) => /FROM payments\b/.test(c.sql));
    assert.ok(reads.some((c) => Number(c.params[0]) === 42), "user 42's own rows were read");
    assert.ok(reads.some((c) => Number(c.params[0]) === 43), "user 43's own rows were read");
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
