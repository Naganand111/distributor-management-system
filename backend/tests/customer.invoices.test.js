/**
 * Phase 9 Step 1: customer invoice narration must never print the literal
 * words "undefined" or "null" when invoice data is missing.
 *
 * Registered through the real customer router with an in-memory conversation
 * pool, so these cover the exact route -> narrate() path (not a mock of it).
 *
 *   V1  valid invoice data keeps the existing wording byte-for-byte
 *   E1  empty invoice result keeps the existing zero-state wording
 *   U1  undefined data (context-only follow-up) returns the safe answer
 *   N1  null data is structurally identical to undefined, pinned at source
 *   N2  a missing summary row takes the guarded path (no partial rendering)
 *   I1  two customers isolated: neither answer leaks the other's invoices
 *
 * Run: node --test tests/customer.invoices.test.js
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

const SAFE_ANSWER = "I could not load your invoice details just now. Please try asking again.";
const VALID_ANSWER =
  "Invoice summary:\n\n• Invoices: 1\n• Total invoiced: ₹1,500.00\n\nYour invoices:\n• INV-9001 — order #301 — 01 Oct 2026 — ₹1,500.00 — Paid";
const EMPTY_ANSWER =
  "Invoice summary:\n\n• Invoices: 0\n• Total invoiced: ₹0.00\n\nYou do not have any invoices yet.";

/* A local (offset-less) timestamp formats to the same calendar date in any
   server timezone, keeping the exact-wording assertion portable. */
const INVOICE_ROW = {
  id: 9,
  invoice_no: "INV-9001",
  order_id: 301,
  invoice_date: "2026-10-01T12:00:00",
  grand_total: 1500,
  payment_status: "paid",
};

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

/* The real tool issues two reads: the invoice list, then a COUNT summary. */
const invoiceResponder = ({ list, summary }) => (sql) => {
  if (/COUNT\(\*\) AS invoices/.test(sql)) return summary;
  if (/FROM invoices/.test(sql)) return list;
  return KITCHEN;
};

/* ================================================================ */

test("V1 valid invoice data keeps the exact existing response wording", async () => {
  const pool = conversationPool(
    invoiceResponder({
      list: [INVOICE_ROW],
      summary: [{ invoices: 1, invoiced_total: 1500 }],
    })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my invoices");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.intent, "my_invoices");
    assert.equal(response.body.data.answer, VALID_ANSWER);
    assert.deepEqual(response.body.data.data.summary, { invoices: 1, invoiced_total: 1500 });
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("E1 an empty invoice result keeps the exact existing zero-state wording", async () => {
  const pool = conversationPool(
    invoiceResponder({
      list: [],
      summary: [{ invoices: 0, invoiced_total: 0 }],
    })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my invoices");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.intent, "my_invoices");
    assert.equal(response.body.data.answer, EMPTY_ANSWER);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("U1 undefined data via a context-only follow-up returns the safe answer", async () => {
  /* Empty prior orders => followUpAnswer() returns null => the route calls
     narrate("my_invoices", undefined). This is the original bug path. */
  const pool = conversationPool((sql) => {
    if (/FROM orders\b/.test(sql)) return [];
    return KITCHEN;
  });
  const { base, close } = await mountCustomer(pool);
  try {
    const first = await askCustomer(base, "show my orders");
    assert.equal(first.body.data.intent, "my_orders");
    const convId = first.body.data.conversationId;
    const queriesAfterTurn1 = pool.businessCalls().length;

    const second = await askCustomer(base, "does it have an invoice?", convId);
    assert.equal(second.status, 200);
    assert.equal(second.body.data.intent, "my_invoices");
    assert.equal(second.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(second.body.data.answer);
    assert.equal(second.body.data.focusOrderId, null);
    assert.ok(!("data" in second.body.data), "no follow-up data was attached");
    assert.equal(
      pool.businessCalls().length,
      queriesAfterTurn1,
      "the missing-data answer runs no invoice tool"
    );
  } finally {
    await close();
  }
});

test("N1 null data is structurally identical to undefined and stays guarded", () => {
  const source = fs.readFileSync(path.join(BACKEND, "routes", "customerAi.js"), "utf8");

  /* narrate() normalises null and undefined identically via `data || {}`, so
     U1 exercises the same runtime branch for both. The route cannot currently
     pass a literal null (followUp carries no data key), so pin the guard
     itself: it must run before the summary count is interpolated. */
  assert.match(source, /function narrate\(intent, data\) \{\s*const d = data \|\| \{\};/);

  const branch = source.slice(
    source.indexOf('if (intent === "my_invoices")'),
    source.indexOf('if (intent === "recent_purchases")')
  );
  assert.ok(branch.length > 0, "the my_invoices branch exists");
  assert.ok(branch.includes("missingData"), "missing data is detected explicitly");
  assert.ok(branch.includes(SAFE_ANSWER), "the safe answer is returned from that branch");
  const guard = branch.indexOf("if (missingData)");
  const render = branch.indexOf("${s.invoices}");
  assert.ok(guard !== -1 && render !== -1 && guard < render, "the guard runs before rendering");
});

test("N2 a missing summary row reaches the guarded path without partial rendering", async () => {
  /* firstRow() returns undefined when the COUNT query yields no row; the
     tools layer drops the undefined `summary` field, so narrate() receives a
     partial object. It must not render "Invoices: undefined" from it. */
  const pool = conversationPool(
    invoiceResponder({ list: [], summary: [] })
  );
  const { base, close } = await mountCustomer(pool);
  try {
    const response = await askCustomer(base, "show my invoices");
    assert.equal(response.status, 200);
    assert.equal(response.body.data.answer, SAFE_ANSWER);
    assertNoLiteralNullish(response.body.data.answer);
  } finally {
    await close();
  }
});

test("I1 customers are isolated: no invoice data crosses user boundaries", async () => {
  const pool = conversationPool((sql, params) => {
    const ownsInvoice = Number(params[0]) === 42;
    if (/COUNT\(\*\) AS invoices/.test(sql)) {
      return [ownsInvoice ? { invoices: 1, invoiced_total: 1500 } : { invoices: 0, invoiced_total: 0 }];
    }
    if (/FROM invoices/.test(sql)) return ownsInvoice ? [INVOICE_ROW] : [];
    return KITCHEN;
  });
  const a = await mountCustomer(pool, { id: 42, role: "customer" });
  const b = await mountCustomer(pool, { id: 43, role: "customer" });
  try {
    const answerA = (await askCustomer(a.base, "show my invoices")).body.data.answer;
    const answerB = (await askCustomer(b.base, "show my invoices")).body.data.answer;

    assert.equal(answerA, VALID_ANSWER, "the owner sees their own invoice");
    assert.equal(answerB, EMPTY_ANSWER, "the other customer sees only their own empty state");
    assert.ok(!answerB.includes("INV-9001"), "no foreign invoice number leaks");
    assert.ok(!answerB.includes("₹1,500.00"), "no foreign total leaks");
    assertNoLiteralNullish(answerA);
    assertNoLiteralNullish(answerB);

    const reads = pool.businessCalls().filter((c) => /FROM invoices/.test(c.sql));
    assert.ok(reads.some((c) => Number(c.params[0]) === 42), "user 42's own rows were read");
    assert.ok(reads.some((c) => Number(c.params[0]) === 43), "user 43's own rows were read");
  } finally {
    await Promise.all([a.close(), b.close()]);
  }
});
